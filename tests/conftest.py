import os
import pytest


@pytest.fixture
def model_config_fixture():
    from server.model_config import ModelConfig
    path = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    return ModelConfig(path)
