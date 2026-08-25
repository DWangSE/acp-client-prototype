import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isFilesystemLeakPermissionRequest,
  isNetworkPermissionRequest,
} from "../src/client-methods/permission-handler.js";

function bashParams(command: string) {
  return {
    title: "Check for locally cached wheel",
    toolCall: {
      kind: "execute",
      _meta: { claudeCode: { toolName: "Bash" } },
      rawInput: { command },
    },
  };
}

test("denies pip download even when the command has no URL", () => {
  assert.equal(
    isNetworkPermissionRequest(
      bashParams("pip download dask==2023.4.0 --no-deps -d /tmp/dask_wheel")
    ),
    true
  );
});

test("denies python -m pip download from nested Bash metadata", () => {
  assert.equal(
    isNetworkPermissionRequest(bashParams("python3.9 -m pip download dask==2023.4.0 --no-deps")),
    true
  );
});

test("still denies curl / https Bash", () => {
  assert.equal(isNetworkPermissionRequest(bashParams("curl https://pypi.org/simple/dask")), true);
  assert.equal(
    isNetworkPermissionRequest({ title: "WebFetch", toolCall: { toolName: "WebFetch" } }),
    true
  );
});

test("denies python -mpip and in-process urllib download", () => {
  assert.equal(
    isNetworkPermissionRequest(bashParams("python3 -mpip download dask==2023.4.0")),
    true
  );
  assert.equal(
    isNetworkPermissionRequest(
      bashParams('python3 -c "import urllib.request; urllib.request.urlretrieve(url)"')
    ),
    true
  );
});

test("allows local compile and grep", () => {
  assert.equal(isNetworkPermissionRequest(bashParams("python3 -m py_compile dask/base.py")), false);
  assert.equal(isNetworkPermissionRequest(bashParams("git status --short")), false);
});

test("denies Bash that reads host dist-packages or aegis oracle trees", () => {
  const previous = process.env.ACP_DENY_PATH_SUBSTRINGS_JSON;
  process.env.ACP_DENY_PATH_SUBSTRINGS_JSON = JSON.stringify([
    "dist-packages",
    "site-packages",
    "/usr/local/aegis",
    "PythonLoader/third_party",
  ]);
  try {
    assert.equal(
      isFilesystemLeakPermissionRequest(
        bashParams("sed -n '960,1000p' /lib/python3/dist-packages/requests/utils.py")
      ),
      true
    );
    assert.equal(
      isFilesystemLeakPermissionRequest(
        bashParams(
          "grep ProtocolError /usr/local/aegis/PythonLoader/third_party/requests/adapters.py"
        )
      ),
      true
    );
    assert.equal(
      isFilesystemLeakPermissionRequest(bashParams("python3 -m py_compile requests/utils.py")),
      false
    );
  } finally {
    if (previous === undefined) delete process.env.ACP_DENY_PATH_SUBSTRINGS_JSON;
    else process.env.ACP_DENY_PATH_SUBSTRINGS_JSON = previous;
  }
});
