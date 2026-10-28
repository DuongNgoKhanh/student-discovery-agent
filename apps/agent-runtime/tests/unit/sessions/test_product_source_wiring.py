import base64
import json

import pytest
from pydantic import SecretStr

from agent_runtime.api.internal.dependencies import _choose_agent_source
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.product.delivery import HttpProductReleaseSource


def b64(byte):
    return base64.b64encode(byte * 32).decode()


STUDENT, STUDIO, CURSOR, DELIVERY = b64(b"s"), b64(b"t"), b64(b"c"), b64(b"d")
STUDENT_KEYS = {"k": base64.b64decode(STUDENT)}


def settings(**overrides):
    values = dict(RUNTIME_AGENT_RELEASE_SOURCE="product", RUNTIME_PRODUCT_URL="http://studio-api:3001",
                  RUNTIME_PRODUCT_SIGNING_KEY=SecretStr(DELIVERY),
                  RUNTIME_STUDIO_KEYRING=SecretStr(json.dumps({"studio": STUDIO})),
                  RUNTIME_CURSOR_SIGNING_KEY=SecretStr(CURSOR))
    return Settings(_env_file=None, **{**values, **overrides})


def test_distinct_key_selects_the_http_source():
    assert isinstance(_choose_agent_source(settings(), "local", STUDENT_KEYS), HttpProductReleaseSource)


def test_local_mode_keeps_the_local_source():
    assert _choose_agent_source(settings(RUNTIME_AGENT_RELEASE_SOURCE="local"), "local", STUDENT_KEYS) == "local"


@pytest.mark.parametrize("overrides", [{"RUNTIME_PRODUCT_URL": None}, {"RUNTIME_PRODUCT_SIGNING_KEY": None}])
def test_missing_url_or_key_means_no_agent_source(overrides):
    assert _choose_agent_source(settings(**overrides), "local", STUDENT_KEYS) is None


@pytest.mark.parametrize("shared", [STUDENT, STUDIO, CURSOR])
def test_delivery_key_shared_with_another_runtime_key_is_rejected(shared):
    assert _choose_agent_source(settings(RUNTIME_PRODUCT_SIGNING_KEY=SecretStr(shared)), "local", STUDENT_KEYS) is None
