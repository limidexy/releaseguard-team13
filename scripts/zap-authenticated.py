"""Send a fixed synthetic API journey through the disposable ZAP proxy."""

import http.client
import json
import sys
import time
import uuid
from collections import Counter


TARGET = "http://gateway:8080"
APPLICATIONS = "/api/v2/applications"
JOBS = "/api/v2/jobs"
RELEASES = "/api/v2/releases"
EVIDENCE = "/api/v2/evidence/00000000-0000-4000-8000-000000000000"
PATHS = {APPLICATIONS, JOBS, RELEASES, EVIDENCE}


def exchange(method, url, headers, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", 8090, timeout=5)
    try:
        connection.request(method, url, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()


def zap_view(api_key, path, field):
    status, _, body = exchange("GET", "/JSON/" + path, {"X-ZAP-API-Key": api_key})
    if status != 200:
        raise RuntimeError("ZAP API request failed")
    return json.loads(body)[field]


def verify(api_key, credentials):
    deadline = time.monotonic() + 60
    while True:
        try:
            zap_view(api_key, "core/view/version/", "version")
            break
        except (OSError, RuntimeError):
            if time.monotonic() >= deadline:
                raise RuntimeError("ZAP did not become ready") from None
            time.sleep(1)
    zap_view(api_key, "core/action/setMode/?mode=safe", "Result")
    mode = zap_view(api_key, "core/view/mode/", "mode")
    if mode.lower() != "safe" or zap_view(api_key, "core/view/sites/", "sites"):
        raise RuntimeError("Expected an empty ZAP session in Safe mode")
    if not zap_view(api_key, "pscan/view/scanners/", "scanners"):
        raise RuntimeError("ZAP passive rules are unavailable")

    checks = []
    expected_requests = Counter()
    marker = "CI authentication fixture " + uuid.uuid4().hex
    fixture = json.dumps({"name": marker, "description": "Disposable CI application"})

    def check(label, path, expected, *, identity=None, method="GET", browser_headers=None):
        if path not in PATHS:
            raise RuntimeError("Unexpected test path")
        headers = {"Accept": "application/json", **(browser_headers or {})}
        if identity:
            headers["Authorization"] = "Bearer " + credentials[identity]
        body = None
        if method == "POST":
            headers["Content-Type"] = "application/json"
            body = fixture
        status, response_headers, data = exchange(method, TARGET + path, headers, body)
        expected_requests[method, TARGET + path] += 1
        record(label, expected, status)
        return response_headers, data

    def record(label, expected, observed):
        checks.append({"name": label, "expected": expected, "observed": observed,
                       "passed": observed == expected})

    def list_has_only_fixture(data):
        entries = json.loads(data)
        return (isinstance(entries, list) and len(entries) == 1
                and isinstance(entries[0], dict) and isinstance(entries[0].get("data"), dict)
                and entries[0]["data"].get("name") == marker)

    check("Applications reject no identity", APPLICATIONS, 401)
    check("Applications reject malformed identity", APPLICATIONS, 401, identity="malformed")
    check("Jobs reject no identity", JOBS, 401)
    check("Evidence rejects no identity", EVIDENCE, 401)
    check("Viewer cannot create an application", APPLICATIONS, 403, method="POST", identity="viewer")
    check("Contributor cross-origin mutation rejected", APPLICATIONS, 403, method="POST",
          identity="contributor", browser_headers={"Origin": "https://other.invalid"})
    check("Contributor cross-site mutation rejected", APPLICATIONS, 403, method="POST",
          identity="contributor", browser_headers={"Sec-Fetch-Site": "cross-site"})
    check("Contributor can create in own workspace", APPLICATIONS, 201, method="POST", identity="contributor")
    headers, own = check("Contributor can read own workspace", APPLICATIONS, 200, identity="contributor")
    _, other = check("Other workspace can read its own list", APPLICATIONS, 200, identity="other")
    _, viewer = check("Viewer can read same-workspace list", APPLICATIONS, 200, identity="viewer")
    record("Rejected mutations left only the approved fixture in the workspace", True, list_has_only_fixture(own))
    csp = headers.get("Content-Security-Policy", "")
    record("Gateway sends CSP form-action self", True,
           "form-action 'self'" in {directive.strip() for directive in csp.split(";")})
    record("Application fixture is isolated and visible to same-workspace viewer", True,
           json.loads(other) == [] and list_has_only_fixture(viewer))
    check("Authenticated jobs list", JOBS, 200, identity="contributor")
    check("Authenticated releases list", RELEASES, 200, identity="viewer")

    deadline = time.monotonic() + 90
    while int(zap_view(api_key, "pscan/view/recordsToScan/", "recordsToScan")):
        if time.monotonic() >= deadline:
            raise RuntimeError("ZAP passive queue did not drain")
        time.sleep(1)
    sites = zap_view(api_key, "core/view/sites/", "sites")
    urls = zap_view(api_key, "core/view/urls/", "urls")
    requested = {TARGET + path for path in PATHS}
    # ZAP's Sites tree also exposes the implied parent nodes.
    parent_nodes = {TARGET, TARGET + "/api", TARGET + "/api/v2", TARGET + "/api/v2/evidence"}
    if sites != [TARGET] or not requested <= set(urls) <= requested | parent_nodes:
        raise RuntimeError("ZAP history does not match the fixed disposable API paths")
    observed = Counter()
    for message in zap_view(api_key, "core/view/messages/", "messages"):
        method, url, _ = message["requestHeader"].splitlines()[0].split(" ", 2)
        if method == "GET" and url in parent_nodes:
            continue
        observed[method, url] += 1
    if observed != expected_requests:
        raise RuntimeError("ZAP did not record exactly the expected API traffic")

    severities = {"Informational": set(), "Low": set(), "Medium": set(), "High": set()}
    for alert in zap_view(api_key, "alert/view/alerts/", "alerts"):
        plugin = str(alert["pluginId"])
        if alert["url"] not in requested or not plugin.isdecimal():
            raise RuntimeError("Unexpected ZAP alert scope or rule ID")
        severities[alert["risk"]].add(int(plugin))
    return {
        "target": TARGET,
        "mode": mode.lower(),
        "paths": sorted(PATHS),
        "proxiedRequests": observed.total(),
        "checks": checks,
        "alertRuleIds": {risk: sorted(ids) for risk, ids in severities.items()},
        "passed": all(check["passed"] for check in checks) and not (severities["High"] or severities["Medium"]),
    }


if __name__ == "__main__":
    try:
        credentials = json.load(sys.stdin)
        result = verify(credentials.pop("apiKey"), credentials | {"malformed": "invalid-ci-token"})
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["passed"] else 1)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
        # Never include HTTP bodies, API responses or credentials in job logs.
        print("Authenticated ZAP verification could not complete", file=sys.stderr)
        sys.exit(1)
