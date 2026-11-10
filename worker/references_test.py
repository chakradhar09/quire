import unittest

import httpx2

from references import Crossref, OpenAlex, abstract_text, lookup, same_title, split_references, title_of
from text import bibliography_start

APA = """Body text of the paper.

IX. REFERENCES
References are listed in APA style. Reference 9 reflects a correction.
[1] Ahmad, L., Khanji, S., Iqbal, F., & Kamoun, F. (2020). Blockchain-based chain of custody: Towards real-time tamper-proof evidence management. In Proceedings of the 15th International Conference on Availability, Reliability and Security (ARES '20). ACM.
[2] Al-Khateeb, H. M., Epiphaniou, G., & Daly, H. (2019). Blockchain for modern digital forensics: The chain-of-custody as a distributed ledger.
[3] Bonomi, S., Casini, M., & Ciccotelli, C. (2018). B-CoC: A blockchain-based chain of custody for evidences management in digital forensics. arXiv preprint. Sapienza Università di Roma.
"""


def entries(text):
    return [text[a:b] for a, b in split_references(text, bibliography_start(text))]


class SplitTest(unittest.TestCase):
    def test_numbered_list_skips_the_heading_and_the_note(self):
        found = entries("x " * 2000 + APA)
        self.assertEqual(len(found), 3)
        self.assertTrue(found[0].startswith("[1] Ahmad"))
        self.assertTrue(found[2].endswith("di Roma."))

    def test_unnumbered_lines_with_a_year_are_entries_and_wrapped_lines_continue_them(self):
        text = "x " * 400 + "\nReferences\nCrosby, S. A., & Wallach, D. S. (2009). Efficient data structures for\ntamper-evident logging. In Proceedings of the 18th USENIX Security Symposium.\nLone, A. H. (2019). Forensic-chain. Digital Investigation.\n"
        found = entries(text)
        self.assertEqual(len(found), 2)
        self.assertIn("tamper-evident logging", found[0])

    def test_no_heading_no_entries(self):
        self.assertEqual(split_references("No references here.", None), [])


class TitleTest(unittest.TestCase):
    def test_apa(self):
        self.assertEqual(title_of("[1] Ahmad, L., & Kamoun, F. (2020). Blockchain-based chain of custody: Towards real-time "
                                  "tamper-proof evidence management. In Proceedings of ARES '20. ACM."),
                         "Blockchain-based chain of custody: Towards real-time tamper-proof evidence management")

    def test_apa_title_at_the_end_of_the_entry(self):
        self.assertEqual(title_of("Al-Khateeb, H. M. (2019). Blockchain for modern digital forensics: The chain-of-custody as a distributed ledger."),
                         "Blockchain for modern digital forensics: The chain-of-custody as a distributed ledger")

    def test_apa_title_before_a_lowercase_container(self):
        self.assertEqual(title_of("Bonomi, S. (2018). B-CoC: A blockchain-based chain of custody for evidences management "
                                  "in digital forensics. arXiv preprint. Sapienza Università di Roma."),
                         "B-CoC: A blockchain-based chain of custody for evidences management in digital forensics")

    def test_ieee_quoted(self):
        self.assertEqual(title_of('[4] S. A. Crosby and D. S. Wallach, “Efficient data structures for tamper-evident logging,” in Proc. USENIX Security, 2009.'),
                         "Efficient data structures for tamper-evident logging")

    def test_mla_quoted(self):
        self.assertEqual(title_of('Smith, John. "Coral Bleaching and Ocean Heat." Nature, vol. 5, 2019, pp. 1-9.'),
                         "Coral Bleaching and Ocean Heat")

    def test_nothing_to_read(self):
        self.assertIsNone(title_of("Smith 2019"))


class MatchTest(unittest.TestCase):
    def test_same_title_ignores_case_and_punctuation(self):
        self.assertTrue(same_title("Blockchain-based chain of custody: towards real-time tamper-proof evidence management",
                                   "Blockchain-Based Chain of Custody - Towards Real-Time Tamper-Proof Evidence Management"))

    def test_a_subtitle_is_the_same_work(self):
        self.assertTrue(same_title("Efficient data structures for tamper-evident logging",
                                   "Efficient Data Structures for Tamper-Evident Logging: A Study"))

    def test_a_different_paper_is_not(self):
        self.assertFalse(same_title("Blockchain for modern digital forensics", "Blockchain for modern supply chains"))

    def test_abstract_is_put_back_in_order(self):
        self.assertEqual(abstract_text({"chain": [1], "Custody": [0], "matters": [2]}), "Custody chain matters")
        self.assertEqual(abstract_text(None), "")


class OpenAlexTest(unittest.TestCase):
    def lookup(self, results):
        seen = []

        def handle(request):
            seen.append(request)
            return httpx2.Response(200, json={"results": results})
        found = OpenAlex(httpx2.Client(transport=httpx2.MockTransport(handle)), spacing=0)
        return found, seen

    def test_returns_the_matching_work_with_its_abstract(self):
        find, seen = self.lookup([
            {"id": "https://openalex.org/W1", "doi": None, "display_name": "Something else entirely", "publication_year": 2001},
            {"id": "https://openalex.org/W2", "doi": "https://doi.org/10.1/x", "display_name": "Efficient Data Structures for Tamper-Evident Logging",
             "publication_year": 2009, "abstract_inverted_index": {"Logs": [0], "matter": [1]}},
        ])
        work = find("Efficient data structures for tamper-evident logging")
        self.assertEqual(work, {"title": "Efficient Data Structures for Tamper-Evident Logging", "url": "https://doi.org/10.1/x",
                                "year": 2009, "abstract": "Logs matter"})
        self.assertEqual(seen[0].url.params["search"], "Efficient data structures for tamper-evident logging")

    def test_none_when_no_title_matches(self):
        find, _ = self.lookup([{"id": "https://openalex.org/W1", "display_name": "Unrelated work"}])
        self.assertIsNone(find("Efficient data structures for tamper-evident logging"))


class CrossrefTest(unittest.TestCase):
    def test_title_and_subtitle_are_joined_and_tags_dropped(self):
        def handle(request):
            return httpx2.Response(200, json={"message": {"items": [{
                "DOI": "10.1145/3407023.3409199", "title": ["Blockchain-based chain of custody"],
                "subtitle": ["Towards real-time tamper-proof evidence management"],
                "issued": {"date-parts": [[2020, 8]]}, "abstract": "<jats:p>Evidence <jats:italic>matters</jats:italic>.</jats:p>"}]}})
        find = Crossref(httpx2.Client(transport=httpx2.MockTransport(handle)), spacing=0)
        self.assertEqual(find("Blockchain-based chain of custody: Towards real-time tamper-proof evidence management"), {
            "title": "Blockchain-based chain of custody: Towards real-time tamper-proof evidence management",
            "url": "https://doi.org/10.1145/3407023.3409199", "year": 2020, "abstract": "Evidence matters ."})


class LookupTest(unittest.TestCase):
    def test_falls_back_and_treats_a_failure_as_a_miss(self):
        def broken(title):
            raise httpx2.ConnectError("offline")
        self.assertEqual(lookup("t", [broken, lambda t: None, lambda t: {"title": "t"}]), {"title": "t"})
        self.assertIsNone(lookup("t", [broken]))


if __name__ == "__main__":
    unittest.main()
