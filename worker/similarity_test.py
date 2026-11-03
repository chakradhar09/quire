"""The similarity job's network-facing parts, with no network: httpx.MockTransport stands in
for Brave and for web servers. Run with the venv: .venv\\Scripts\\python -m unittest discover -p "*_test.py"
"""
import json
import pathlib
import unittest

import httpx

from search import BraveSearch, Fetcher, RateLimited, UnsafeUrl, check_url, extract
from text import pick_queries

FIXTURE = (pathlib.Path(__file__).parent / "fixtures" / "article_page.html").read_text(encoding="utf-8")
PUBLIC = "http://93.184.216.34"  # an IP literal, so the address guard needs no DNS


def sentence(i, n=15):
    return " ".join(f"topic{i} word{j}" if j == 0 else f"word{i}x{j}" for j in range(n)) + "."


class PickQueriesTest(unittest.TestCase):
    def test_each_query_is_a_whole_sentence_of_the_draft_without_quotes(self):
        # Brave's quoted-phrase search missed a copied Wikipedia sentence that the plain sentence found first (CP4).
        text = " ".join(sentence(i) for i in range(5))
        queries = pick_queries(text, budget=10)
        self.assertEqual(queries, [sentence(i) for i in range(5)])
        # A quotation ending a sentence leaves its closing mark at the start of the next one.
        (q,) = pick_queries('” " ' + sentence(9), budget=1)
        self.assertEqual(q, sentence(9), "no quote marks, which Brave would read as an exact phrase")

    def test_a_long_sentence_is_cut_at_a_word_to_fit_braves_400_characters(self):
        long = " ".join(f"extraordinarily{i}" for i in range(35)) + "."
        (q,) = pick_queries(long, budget=1)
        self.assertLessEqual(len(q), 400)
        self.assertTrue(long.startswith(q) and long[len(q)] == " ")

    def test_never_exceeds_the_budget_and_spreads_queries_over_the_draft(self):
        text = " ".join(sentence(i) for i in range(20))
        queries = pick_queries(text, budget=4)
        self.assertEqual(len(queries), 4)
        self.assertEqual([q.split()[0] for q in queries], ["topic0", "topic5", "topic10", "topic15"])

    def test_skips_short_long_and_mostly_filler_sentences(self):
        short = "Too short to search for."
        long = sentence(1, n=45)
        filler = "It is the one that is in the way of the thing that it was and is to be."
        self.assertEqual(pick_queries(" ".join([short, long, filler]), budget=10), [])

    def test_a_zero_budget_spends_nothing(self):
        self.assertEqual(pick_queries(sentence(1), budget=0), [])


class CheckUrlTest(unittest.TestCase):
    def test_refuses_anything_that_is_not_a_public_web_address(self):
        for url in ["file:///C:/Windows/win.ini", "ftp://93.184.216.34/x", "http://127.0.0.1:3000/",
                    "http://localhost:3000/", "http://[::1]/", "http://10.0.0.1/", "http://192.168.1.1/",
                    "http://169.254.169.254/latest/meta-data", "http://0.0.0.0/", "http:///nohost",
                    "http://[::ffff:127.0.0.1]:3000/"]:
            with self.subTest(url=url), self.assertRaises(UnsafeUrl):
                check_url(url)

    def test_accepts_public_http_and_https(self):
        check_url("http://8.8.8.8/page")
        check_url("https://1.1.1.1/a?b=c")


def server(routes):
    """A MockTransport: routes maps URL (without query) to a handler, or to (status, headers, body)."""
    def handle(request):
        key = str(request.url.copy_with(query=None))
        route = routes.get(key, (404, {}, b""))
        if callable(route):
            return route(request)
        status, headers, body = route
        return httpx.Response(status, headers=headers, content=body)
    return httpx.Client(transport=httpx.MockTransport(handle))


HTML = {"content-type": "text/html; charset=utf-8"}


class FetcherTest(unittest.TestCase):
    def fetcher(self, routes):
        return Fetcher(client=server(routes), min_interval=0)

    def test_returns_the_article_title_and_text_without_page_chrome(self):
        title, text = self.fetcher({f"{PUBLIC}/mangroves": (200, HTML, FIXTURE.encode())}).fetch(f"{PUBLIC}/mangroves")
        self.assertEqual(title, "Why mangroves matter")
        self.assertIn("Their tangled roots slow the tide", text)
        self.assertNotIn("Cookie settings", text)

    def test_follows_a_redirect_to_another_public_page(self):
        f = self.fetcher({f"{PUBLIC}/old": (301, {"location": "/mangroves"}, b""),
                          f"{PUBLIC}/mangroves": (200, HTML, FIXTURE.encode())})
        self.assertIsNotNone(f.fetch(f"{PUBLIC}/old"))

    def test_refuses_a_redirect_into_your_own_machine(self):
        f = self.fetcher({f"{PUBLIC}/trap": (302, {"location": "http://127.0.0.1:3000/"}, b"")})
        with self.assertRaises(UnsafeUrl):
            f.fetch(f"{PUBLIC}/trap")

    def test_respects_robots_txt(self):
        f = self.fetcher({f"{PUBLIC}/robots.txt": (200, {"content-type": "text/plain"}, b"User-agent: *\nDisallow: /private\n"),
                          f"{PUBLIC}/private/page": (200, HTML, FIXTURE.encode())})
        self.assertIsNone(f.fetch(f"{PUBLIC}/private/page"))

    def test_skips_pages_over_5_mb_and_non_web_pages(self):
        big = b"<p>" + b"x" * (5 * 1024 * 1024 + 1) + b"</p>"
        f = self.fetcher({f"{PUBLIC}/big": (200, HTML, big),
                          f"{PUBLIC}/paper.pdf": (200, {"content-type": "application/pdf"}, b"%PDF-1.7")})
        self.assertIsNone(f.fetch(f"{PUBLIC}/big"))
        self.assertIsNone(f.fetch(f"{PUBLIC}/paper.pdf"))

    def test_identifies_itself_with_the_contact_you_set(self):
        seen = {}

        def page(request):
            seen["ua"] = request.headers["user-agent"]
            return httpx.Response(200, headers=HTML, content=FIXTURE.encode())
        Fetcher(client=server({f"{PUBLIC}/p": page}), min_interval=0, contact="me@example.org").fetch(f"{PUBLIC}/p")
        self.assertIn("Quire", seen["ua"])
        self.assertIn("me@example.org", seen["ua"])


class BraveSearchTest(unittest.TestCase):
    API = "https://api.search.brave.com/res/v1/web/search"

    def test_sends_the_key_and_returns_result_urls(self):
        seen = {}

        def api(request):
            seen.update(key=request.headers["x-subscription-token"], q=request.url.params["q"],
                        count=request.url.params["count"])
            body = {"web": {"results": [{"url": "https://a.example/1"}, {"url": "https://b.example/2"}]}}
            return httpx.Response(200, json=body)
        brave = BraveSearch(key="k-123", client=server({self.API: api}), spacing=0)
        self.assertEqual(brave('"tangled roots slow the tide"'), ["https://a.example/1", "https://b.example/2"])
        self.assertEqual(seen, {"key": "k-123", "q": '"tangled roots slow the tide"', "count": "3"})

    def test_no_web_results_is_an_empty_list(self):
        brave = BraveSearch(key="k", client=server({self.API: (200, {}, json.dumps({}).encode())}), spacing=0)
        self.assertEqual(brave('"nothing"'), [])

    def test_a_rate_limit_says_to_try_again(self):
        brave = BraveSearch(key="k", client=server({self.API: (429, {}, b"")}), spacing=0)
        with self.assertRaisesRegex(RateLimited, "try again in a minute"):
            brave('"q"')

    def test_a_missing_key_says_where_to_put_it(self):
        with self.assertRaisesRegex(RuntimeError, r"Brave Search API key.*Settings page"):
            BraveSearch(key="", client=server({}))

    def test_a_rejected_key_says_so_instead_of_an_http_error(self):
        brave = BraveSearch(key="wrong", client=server({BraveSearch.API: (401, {}, b"")}), spacing=0)
        with self.assertRaisesRegex(RuntimeError, r"rejected the API key.*Settings page"):
            brave("coral reefs")


class ExtractTest(unittest.TestCase):
    def test_extracted_text_is_normalized(self):
        title, text = extract(FIXTURE.replace("salt water", "salt\u200bwater"))
        self.assertNotIn("\u200b", text)


if __name__ == "__main__":
    unittest.main()
