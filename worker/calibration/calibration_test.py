"""Calibration data: the PERSUADE download and sample, and the OpenRouter essay writer.
Fake transports only: nothing here touches the network."""
import csv
import io
import json
import pathlib
import tempfile
import unittest

import httpx

from calibration import generate_ai, persuade

COLUMNS = ["essay_id","essay_id_comp", "full_text", "discourse_text", "task", "source_text",
                                   "prompt_name", "assignment", "grade_level"]


def long_essay(topic, n=30):
    return "\n".join(f"Paragraph {i} explains why {topic} matters to students in a school like mine today." for i in range(n))


def csv_bytes(rows, columns=COLUMNS):
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=columns)
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in columns})
    return out.getvalue().encode("utf-8")


ROWS = [  # one row per discourse element, the whole essay repeated on each, as in the real file
    {"essay_id_comp": "A1", "full_text": long_essay("phones"), "discourse_text": "x", "task": "Independent",
     "prompt_name": "Phones and driving", "assignment": "Should drivers use phones?", "grade_level": "10"},
    {"essay_id_comp": "A1", "full_text": long_essay("phones"), "discourse_text": "y", "task": "Independent",
     "prompt_name": "Phones and driving", "assignment": "Should drivers use phones?", "grade_level": "10"},
    {"essay_id_comp": "B2", "full_text": long_essay("Venus") + '\n"Quoted, with a\nline break."', "discourse_text": "z",
     "task": "Text dependent", "source_text": "Venus is hot.", "prompt_name": "Exploring Venus",
     "assignment": "Is studying Venus worthwhile?", "grade_level": "8"},
]


class TempDir(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.dir = pathlib.Path(tmp.name)


class DownloadTest(TempDir):
    def client(self, handler):
        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_keeps_one_row_per_essay_and_the_prompts_beside_them(self):
        body = csv_bytes(ROWS)
        n = persuade.download(self.dir, self.client(lambda r: httpx.Response(200, content=body,
                                                                            headers={"content-type": "application/octet-stream"})))
        self.assertEqual(n, 2)
        essays = list(csv.DictReader((self.dir / persuade.ESSAYS).open(encoding="utf-8", newline="")))
        self.assertEqual([e["id"] for e in essays], ["A1", "B2"])
        self.assertTrue(essays[1]["text"].endswith('"Quoted, with a\nline break."'), "line breaks inside fields survive")
        prompts = json.loads((self.dir / persuade.PROMPTS).read_text(encoding="utf-8"))
        self.assertEqual(prompts["Exploring Venus"], {"task": "Text dependent", "assignment": "Is studying Venus worthwhile?",
                                                      "source_text": "Venus is hot."})
        self.assertFalse(list(self.dir.glob("*.part")), "no partial file left behind")

    def test_follows_drives_confirmation_page(self):
        page = ('<html><form id="download-form" action="https://drive.usercontent.google.com/download" method="get">'
                '<input type="hidden" name="id" value="X"><input type="hidden" name="confirm" value="t">'
                '<input type="hidden" name="uuid" value="u-1"></form></html>')
        seen = []

        def handler(request):
            seen.append(request.url.params.get("uuid"))
            if request.url.params.get("uuid") == "u-1":
                return httpx.Response(200, content=csv_bytes(ROWS), headers={"content-type": "text/csv"})
            return httpx.Response(200, text=page, headers={"content-type": "text/html; charset=utf-8"})
        self.assertEqual(persuade.download(self.dir, self.client(handler)), 2)
        self.assertEqual(seen, [None, "u-1"])

    def test_resumes_where_drive_dropped_the_connection(self):
        body = csv_bytes(ROWS)
        cut = len(body) // 2
        ranges = []

        def dropped():
            yield body[:cut]
            raise httpx.RemoteProtocolError("peer closed connection without sending complete message body")

        def handler(request):
            ranges.append(request.headers.get("range"))
            if request.headers.get("range") == f"bytes={cut}-":
                return httpx.Response(206, content=body[cut:])
            return httpx.Response(200, content=dropped(), headers={"content-type": "application/octet-stream"})
        self.assertEqual(persuade.download(self.dir, self.client(handler)), 2)
        self.assertEqual(ranges, [None, f"bytes={cut}-"])

    def test_stops_with_the_readme_link_when_the_file_is_not_the_corpus(self):
        bad = csv_bytes([{"a": "1"}], columns=["a", "b"])
        with self.assertRaisesRegex(RuntimeError, "github.com/scrosseye/persuade_corpus_2.0"):
            persuade.download(self.dir, self.client(lambda r: httpx.Response(200, content=bad)))
        with self.assertRaisesRegex(RuntimeError, "github.com/scrosseye"):
            persuade.download(self.dir, self.client(lambda r: httpx.Response(
                200, text="<html>quota exceeded</html>", headers={"content-type": "text/html"})))
        self.assertFalse((self.dir / persuade.ESSAYS).exists())


class SampleTest(TempDir):
    def write(self, essays):
        with (self.dir / persuade.ESSAYS).open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["id", "prompt", "grade", "text"])
            w.writeheader()
            w.writerows(essays)

    def test_spreads_over_the_prompts_skips_short_essays_and_never_changes(self):
        essays = [{"id": f"{p}{i}", "prompt": p, "grade": "9", "text": long_essay(p)} for p in "ABC" for i in range(5)]
        essays.append({"id": "short", "prompt": "A", "grade": "9", "text": "Too short to count for anything at all."})
        self.write(essays)
        picked = persuade.sample(self.dir, 6, seed=1)
        self.assertEqual(sorted(e["prompt"] for e in picked), ["A", "A", "B", "B", "C", "C"])
        self.assertNotIn("short", [e["id"] for e in picked])
        self.assertEqual(picked, persuade.sample(self.dir, 6, seed=1))
        self.assertNotEqual([e["id"] for e in picked], [e["id"] for e in persuade.sample(self.dir, 6, seed=2)])


class GenerateTest(TempDir):
    PROMPTS = {"Phones and driving": {"task": "Independent", "assignment": "Should drivers use phones?", "source_text": ""},
               "Exploring Venus": {"task": "Text dependent", "assignment": "Is Venus worth it?", "source_text": "Venus is hot."}}

    def setUp(self):
        super().setUp()
        (self.dir / persuade.PROMPTS).write_text(json.dumps(self.PROMPTS), encoding="utf-8")
        self.sent = []

    def run_with(self, handler, models=("m/one:free", "m/two:free")):
        def record(request):
            self.sent.append(request)
            return handler(request)
        return generate_ai.generate(self.dir, key="sk-test", models=list(models), per_prompt=1,
                                    client=httpx.Client(transport=httpx.MockTransport(record)), pause=0, retry_wait=0,
                                    log=lambda *a: None)

    @staticmethod
    def reply(text="Phones distract drivers. " * 20):
        return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})

    def test_writes_one_essay_per_prompt_and_model_sending_only_the_assignment(self):
        written, stopped = self.run_with(lambda r: self.reply())
        self.assertEqual((written, stopped), (4, None))
        self.assertEqual(sorted(p.name for p in (self.dir / "ai").iterdir()), [
            "exploring-venus-m-one-free-1.txt", "exploring-venus-m-two-free-1.txt",
            "phones-and-driving-m-one-free-1.txt", "phones-and-driving-m-two-free-1.txt"])
        self.assertEqual({r.headers["authorization"] for r in self.sent}, {"Bearer sk-test"})
        phones = next(json.loads(r.content)["messages"][0]["content"] for r in self.sent if b"drivers use phones" in r.content)
        self.assertNotIn("sources you read", phones, "an independent task gets the assignment alone")
        venus = next(json.loads(r.content)["messages"][0]["content"] for r in self.sent if b"Is Venus worth it" in r.content)
        self.assertIn("Venus is hot.", venus, "a source-based task gets the sources students had")

    def test_resumes_by_skipping_essays_already_written(self):
        self.run_with(lambda r: self.reply())
        self.sent.clear()
        written, _ = self.run_with(lambda r: self.reply())
        self.assertEqual((written, self.sent), (0, []))

    def test_stops_at_the_rate_limit_with_a_message_keeping_what_it_wrote(self):
        calls = iter([self.reply(), httpx.Response(429, json={"error": {"message": "Rate limit exceeded: free-models-per-day"}})])
        written, stopped = self.run_with(lambda r: next(calls, httpx.Response(429, json={})))
        self.assertEqual(written, 1)
        self.assertIn("free-models-per-day", stopped)
        self.assertEqual(len(list((self.dir / "ai").iterdir())), 1)

    def test_a_busy_provider_is_retried_then_skipped_while_other_models_carry_on(self):
        def handler(request):
            if b"m/one" in request.content:
                return httpx.Response(429, json={"error": {"message": "Provider returned error"}})
            return self.reply()
        written, stopped = self.run_with(handler)
        self.assertEqual((written, stopped), (2, None))
        one = [r for r in self.sent if b"m/one" in r.content]
        self.assertEqual(len(one), 3, "tried three times, then left for this run")
        self.assertTrue(all("m-two" in p.name for p in (self.dir / "ai").iterdir()))

    def test_skips_a_model_that_fails_or_writes_nothing(self):
        def handler(request):
            if b"m/two" in request.content:
                return httpx.Response(404, json={"error": {"message": "No endpoints found"}})
            if b"Venus" in request.content:  # OpenRouter can report an error inside a 200
                return httpx.Response(200, json={"error": {"message": "Upstream timed out", "code": 502}})
            return self.reply("")
        written, stopped = self.run_with(handler)
        self.assertEqual((written, stopped), (0, None))
        self.assertEqual(list((self.dir / "ai").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
