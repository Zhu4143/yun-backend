import unittest
from request_policy import trusted_request


class RequestPolicyTests(unittest.TestCase):
    def test_native_backend_and_random_desktop_ports(self):
        for origin in [None, "http://127.0.0.1:3030", "http://localhost:5175", "http://127.0.0.1:54321"]:
            headers = {"host": "127.0.0.1:17894"}
            if origin:
                headers["origin"] = origin
            self.assertTrue(trusted_request(headers, "127.0.0.1"))

    def test_hostile_browser_and_dns_rebinding_are_denied(self):
        for origin in ["null", "https://untrusted.invalid", "http://localhost.untrusted.invalid:5173"]:
            self.assertFalse(trusted_request({"host": "127.0.0.1:17894", "origin": origin}, "127.0.0.1"))
        self.assertFalse(trusted_request({"host": "rebound.invalid:17894"}, "127.0.0.1"))
        self.assertFalse(trusted_request({"host": "127.0.0.1:17894", "sec-fetch-site": "cross-site"}, "127.0.0.1"))

    def test_remote_clients_are_denied_even_with_loopback_host(self):
        self.assertFalse(trusted_request({"host": "127.0.0.1:17894"}, "192.0.2.1"))


if __name__ == "__main__":
    unittest.main()
