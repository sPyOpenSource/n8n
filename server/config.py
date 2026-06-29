"""Server configuration management."""

import os
import json
import threading

class ConfigManager:
    def __init__(self, config_path="config.json"):
        self.config_path = config_path
        self._lock = threading.Lock()
        self._cached_config = {}
        self._reload_callbacks = []
        
        # Define the lowest level of the hierarchy: hardcoded defaults
        self.DEFAULTS = {
            "PROVIDER_PRIORITY": "copilot,ollama,openai",
            "RATE_LIMIT_RPM": 12,
            "RATE_LIMIT_BURST": 4,
            "OLLAMA_BASE_URL": "http://localhost:11434",
            "OPENAI_BASE_URL": "https://api.openai.com",
            "MODEL_NAME": "copilot",
        }
        
        # Initial load
        self.reload()

    def _merge_config(self) -> dict:
        """Calculates the final config: Env > JSON > Defaults"""
        final = self.DEFAULTS.copy()

        # Layer 2: Override with JSON file if it exists
        try:
            with open(self.config_path, "r") as f:
                file_config = json.load(f)
                final.update({k: v for k, v in file_config.items() if k in self.DEFAULTS})
        except (FileNotFoundError, json.JSONDecodeError):
            pass

        # Layer 3: Override with Environment Variables (Highest Priority)
        for key in self.DEFAULTS:
            env_val = os.environ.get(key)
            if env_val is not None:
                default_type = type(self.DEFAULTS[key])
                try:
                    final[key] = default_type(env_val)
                except ValueError:
                    final[key] = env_val

        return final

    def on_reload(self, callback):
        """Register a callback to be executed after reload."""
        self._reload_callbacks.append(callback)

    def reload(self):
        """Re-computes the merge and updates the cache."""
        with self._lock:
            self._cached_config = self._merge_config()
        
        for callback in self._reload_callbacks:
            callback()

    def get(self, key):
        """Fast access to the merged configuration."""
        return self._cached_config.get(key)

# Singleton instance for the server
config = ConfigManager()

