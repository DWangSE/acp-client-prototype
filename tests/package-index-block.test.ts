import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  OFFLINE_NSSWITCH,
  PACKAGE_INDEX_FETCH_RE,
  SCRIPT_NETWORK_RE,
  renderOfflineJailHosts,
} from "../src/security/package-index-block.js";

test("PACKAGE_INDEX_FETCH_RE matches pip download without a URL", () => {
  assert.match("pip download dask==2023.4.0 --no-deps -d /tmp/dask_wheel", PACKAGE_INDEX_FETCH_RE);
  assert.match("pip3 download dask==2023.4.0", PACKAGE_INDEX_FETCH_RE);
  assert.match("python3.9 -m pip download dask==2023.4.0 --no-deps", PACKAGE_INDEX_FETCH_RE);
  assert.match("python3 -mpip download dask==2023.4.0", PACKAGE_INDEX_FETCH_RE);
  assert.match("uv pip install dask==2023.4.0", PACKAGE_INDEX_FETCH_RE);
});

test("PACKAGE_INDEX_FETCH_RE allows local python verification", () => {
  assert.doesNotMatch("python3 -m py_compile dask/base.py", PACKAGE_INDEX_FETCH_RE);
  assert.doesNotMatch("python -m pytest dask/tests/test_base.py", PACKAGE_INDEX_FETCH_RE);
  assert.doesNotMatch("grep -n pip dask/setup.py", PACKAGE_INDEX_FETCH_RE);
});

test("SCRIPT_NETWORK_RE matches urllib download helpers but not grep", () => {
  assert.match(
    'python3 -c "import urllib.request; urllib.request.urlretrieve(u)"',
    SCRIPT_NETWORK_RE
  );
  assert.match("from urllib.request import urlopen", SCRIPT_NETWORK_RE);
  assert.doesNotMatch("grep -n urllib requests/utils.py", SCRIPT_NETWORK_RE);
  assert.doesNotMatch("python3 -c 'import requests; print(requests.__file__)'", SCRIPT_NETWORK_RE);
});

test("offline jail hosts allow only the model API, not gold indexes", () => {
  const previous = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = "https://127.0.0.1/compatible-mode/v1";
  try {
    const hosts = renderOfflineJailHosts();
    assert.match(hosts, /127\.0\.0\.1 localhost/);
    assert.doesNotMatch(hosts, /pypi\.org/);
    assert.doesNotMatch(hosts, /github\.com/);
    assert.doesNotMatch(hosts, /huggingface\.co/);
    assert.doesNotMatch(hosts, /mirrors\.aliyun\.com/);
    assert.match(OFFLINE_NSSWITCH, /hosts: files/);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous;
  }
});
