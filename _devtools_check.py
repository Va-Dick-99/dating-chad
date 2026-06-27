import json
import time
import urllib.request

import websocket  # websocket-client

EXT_PATH = r"C:\Users\Va Dick\Vibe Projects\dating-chad\extension"
DEBUG = "http://127.0.0.1:9222"


def http_json(path):
    return json.loads(urllib.request.urlopen(DEBUG + path, timeout=10).read())


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=15, max_size=None)
        self._id = 0

    def send(self, method, params=None, sid=None):
        self._id += 1
        mid = self._id
        msg = {"id": mid, "method": method, "params": params or {}}
        if sid:
            msg["sessionId"] = sid
        self.ws.send(json.dumps(msg))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == mid:
                return resp


# 1) Load the unpacked extension at the browser level.
ver = http_json("/json/version")
browser = CDP(ver["webSocketDebuggerUrl"])
res = browser.send("Extensions.loadUnpacked", {"path": EXT_PATH})
print("loadUnpacked ->", json.dumps(res.get("result", res.get("error")), ensure_ascii=False))
ext_id = res.get("result", {}).get("id")

# 2) Open Badoo in a tab and verify the content script injected.
new = http_json("/json/new?https://badoo.com")
page = CDP(new["webSocketDebuggerUrl"])
page.send("Page.enable")
page.send("Page.navigate", {"url": "https://badoo.com"})
time.sleep(6)


def ev(expr):
    r = page.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("result", {}).get("value")


print("INJECTED:", json.dumps(ev(
    "({loaded: !!window.__datingChadLoaded, fab: !!document.querySelector('.dc-fab'), "
    "panel: !!document.querySelector('.dc-panel'), href: location.href})"
), ensure_ascii=False))
