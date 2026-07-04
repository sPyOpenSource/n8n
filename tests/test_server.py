"""Tests for server startup configuration."""

import os
import unittest
from unittest.mock import patch

from server import app
from server.prompt import trim_messages


class ServerStartupTests(unittest.TestCase):
    @patch("uvicorn.run")
    @patch("copilot.auth.load_auth")
    def test_uses_default_address(self, _load_auth, run):
        with patch.dict(os.environ, {}, clear=True):
            app()

        self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")
        self.assertEqual(run.call_args.kwargs["port"], 8000)

    @patch("uvicorn.run")
    @patch("copilot.auth.load_auth")
    def test_uses_address_from_environment(self, _load_auth, run):
        with patch.dict(os.environ, {"HOST": "0.0.0.0", "PORT": "8080"}, clear=True):
            app()

        self.assertEqual(run.call_args.kwargs["host"], "0.0.0.0")
        self.assertEqual(run.call_args.kwargs["port"], 8080)

    @patch("uvicorn.run")
    @patch("copilot.auth.load_auth")
    def test_explicit_address_takes_precedence(self, _load_auth, run):
        with patch.dict(os.environ, {"HOST": "0.0.0.0", "PORT": "8080"}, clear=True):
            app(host="localhost", port=0)

        self.assertEqual(run.call_args.kwargs["host"], "localhost")
        self.assertEqual(run.call_args.kwargs["port"], 0)


class TrimMessagesTests(unittest.TestCase):
    def test_keeps_all_when_under_limit(self):
        msgs = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
        self.assertEqual(trim_messages(msgs, max_messages=5), msgs)

    def test_trims_to_max(self):
        msgs = [{"role": "user", "content": str(i)} for i in range(20)]
        trimmed = trim_messages(msgs, max_messages=5)
        self.assertEqual(len(trimmed), 5)
        self.assertEqual(trimmed[-1]["content"], "19")

    def test_preserves_system_prompt(self):
        msgs = [
            {"role": "system", "content": "you are a helpful assistant"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        trimmed = trim_messages(msgs, max_messages=1)
        self.assertEqual(len(trimmed), 2)
        self.assertEqual(trimmed[0]["role"], "system")
        self.assertEqual(trimmed[1]["role"], "assistant")

    def test_empty_input(self):
        self.assertEqual(trim_messages([]), [])

    def test_max_messages_zero_returns_system_only(self):
        msgs = [
            {"role": "system", "content": "be helpful"},
            {"role": "user", "content": "hi"},
        ]
        trimmed = trim_messages(msgs, max_messages=0)
        self.assertEqual(len(trimmed), 1)
        self.assertEqual(trimmed[0]["role"], "system")


if __name__ == "__main__":
    unittest.main()
