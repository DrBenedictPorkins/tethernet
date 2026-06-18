#!/usr/bin/env python3
"""
Tethernet Telemetry Test Harness
Single-shot ping to any third-party analytics/telemetry endpoint with variable payload.
Tests Tethernet's ability to detect, capture, and validate telemetry submissions.

Usage:
  uv run test/telemetry-ping.py --endpoint conviva
  uv run test/telemetry-ping.py --endpoint nielsen
  uv run test/telemetry-ping.py --endpoint comscore
  uv run test/telemetry-ping.py --endpoint newrelic
  uv run test/telemetry-ping.py --endpoint ga4
  uv run test/telemetry-ping.py --endpoint segment
  uv run test/telemetry-ping.py --endpoint amplitude
  uv run test/telemetry-ping.py --endpoint all
  uv run test/telemetry-ping.py --endpoint conviva --title "My Show" --playhead 342 --userid 99999
"""

import argparse
import json
import time
import random
import string
import urllib.request
import urllib.parse
import urllib.error
from dataclasses import dataclass

# --- Variable data pools ---

TITLES = [
    "Test Show Alpha - S01E01",
    "Test Show Beta - S02E05",
    "Test Show Gamma - S03E10",
    "Sample Video Title One",
    "Sample Video Title Two",
    "Demo Content Episode 1",
    "Preview Clip Short Form",
    "Feature Film Test Entry",
    "Live Event Simulation Run",
    "Documentary Test Segment",
]

CONTENT_IDS = [
    "test_content_alpha_001_vod",
    "test_content_beta_002_vod",
    "test_content_gamma_003_live",
    "test_content_delta_004_clip",
    "test_content_epsilon_005_vod",
]

STREAM_IDS = [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "deadbeef-cafe-babe-f00d-123456789abc",
    "11111111-2222-3333-4444-555555555555",
]

def rand_str(n=16):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=n))

def rand_session_id():
    return str(random.randint(1000000000000, 9999999999999))


# --- Endpoint builders ---

def build_conviva(playhead, userid, contentid, title, sessionid, ts):
    """Conviva Quality of Experience analytics — used by many video platforms"""
    customer_key = "87a6b28bc7823e67a5bb2a0a6728c702afcae78d"
    payload = json.dumps({
        "t": "CwsSessionHb",
        "cid": customer_key,
        "clid": f"{ts}.{random.randint(100000000, 999999999)}",
        "sid": random.randint(100000000, 999999999),
        "seq": random.randint(1, 100),
        "pver": "2.8",
        "clv": "4.8.0",
        "vid": str(userid),
        "an": title,
        "pn": "TestPlayer-1.0",
        "br": random.choice([500, 1000, 2000, 4000, 8000]),
        "rs": random.choice(["Fastly", "Akamai", "CloudFront"]),
        "efps": 24,
        "pht": playhead * 1000,
        "st": ts,
        "sst": ts - random.randint(10000, 600000),
        "ps": 3,
        "lv": False,
        "cl": random.randint(1200, 5400),
        "w": 1920, "h": 1080,
        "tags": {
            "contentId": contentid,
            "episodeTitle": title,
            "drmType": "Widevine",
            "stream_id": random.choice(STREAM_IDS),
        }
    }).encode()
    return {
        "name": "Conviva QoE",
        "method": "POST",
        "url": f"https://{customer_key}.cws.conviva.com/0/wsg",
        "body": payload,
        "headers": {"Content-Type": "application/json"},
    }

def build_nielsen(playhead, userid, contentid, title, sessionid, ts):
    """Nielsen DCR — audience measurement, used for ratings compliance"""
    params = urllib.parse.urlencode({
        "prd": "dcr",
        "ci": "us-700144",
        "ch": "us-700144_c01_P",
        "ca": f"us-700144_c01_{contentid}",
        "cg": title,
        "c1": f"nuid,{rand_str(32)}",
        "at": "timer",
        "rt": "video",
        "c27": f"cln,{playhead}",
        "c29": f"plid,{ts}{random.randint(1000000, 9999999)}",
        "c3": "st,c",
        "c58": "isLive,false",
        "c59": f"sesid,{rand_str(32)}",
        "ai": contentid,
        "sd": random.randint(1200, 5400),
    })
    return {
        "name": "Nielsen DCR",
        "method": "GET",
        "url": f"https://secure-dcr.imrworldwide.com/cgi-bin/gn?{params}",
        "body": None,
        "headers": {},
    }

def build_comscore(playhead, userid, contentid, title, sessionid, ts):
    """Comscore Streaming Tag — audience measurement"""
    params = urllib.parse.urlencode({
        "c1": 19,
        "c2": 3005086,
        "ns_ap_an": "TestApp",
        "ns_st_ev": "hb",
        "ns_st_hd": 60000,
        "ns_st_hc": random.randint(1, 50),
        "ns_st_po": playhead * 1000,
        "ns_st_pt": playhead * 1000,
        "ns_st_cl": random.randint(1200, 5400) * 1000,
        "ns_st_ci": contentid,
        "ns_st_ep": title,
        "ns_st_br": 0,
        "ns_st_rt": 100,
        "ns_st_ct": "vc12",
        "ns_st_mp": "test-player-1.0",
        "c3": "TestApp",
        "c4": "TestNetwork",
        "c6": title,
    })
    return {
        "name": "Comscore Streaming",
        "method": "GET",
        "url": f"https://sb.scorecardresearch.com/p?{params}",
        "body": None,
        "headers": {},
    }

def build_newrelic(playhead, userid, contentid, title, sessionid, ts):
    """New Relic Browser APM — infrastructure/performance monitoring"""
    key = "NRJS-b5dcb3a7b0855a31fdd"
    payload = json.dumps([{
        "type": "PageAction",
        "timestamp": ts,
        "actionName": "video_heartbeat",
        "contentId": contentid,
        "playhead": playhead,
        "userId": str(userid),
        "title": title,
    }]).encode()
    return {
        "name": "New Relic APM",
        "method": "POST",
        "url": f"https://bam.nr-data.net/events/1/{key}",
        "body": payload,
        "headers": {"Content-Type": "application/json"},
    }

def build_ga4(playhead, userid, contentid, title, sessionid, ts):
    """Google Analytics 4 — general purpose analytics"""
    params = urllib.parse.urlencode({
        "v": "2",
        "tid": "G-TESTID12345",
        "cid": str(userid),
        "en": "video_progress",
        "ep.video_title": title,
        "ep.video_current_time": playhead,
        "ep.video_id": contentid,
        "ep.video_percent": min(100, int((playhead / 1800) * 100)),
    })
    return {
        "name": "Google Analytics 4",
        "method": "POST",
        "url": f"https://www.google-analytics.com/g/collect?{params}",
        "body": b"",
        "headers": {},
    }

def build_segment(playhead, userid, contentid, title, sessionid, ts):
    """Segment — customer data platform, routes to downstream analytics"""
    payload = json.dumps({
        "type": "track",
        "event": "Video Content Playing",
        "userId": str(userid),
        "anonymousId": rand_str(20),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts / 1000)),
        "properties": {
            "session_id": sessionid,
            "content_asset_id": contentid,
            "title": title,
            "position": playhead,
            "total_length": random.randint(1200, 5400),
            "video_player": "test-player",
        },
        "writeKey": "test_write_key_harness",
    }).encode()
    return {
        "name": "Segment",
        "method": "POST",
        "url": "https://api.segment.io/v1/track",
        "body": payload,
        "headers": {"Content-Type": "application/json"},
    }

def build_amplitude(playhead, userid, contentid, title, sessionid, ts):
    """Amplitude — product analytics"""
    payload = urllib.parse.urlencode({
        "api_key": "test_amplitude_api_key_harness",
        "event": json.dumps({
            "user_id": str(userid),
            "session_id": int(sessionid),
            "event_type": "video_heartbeat",
            "time": ts,
            "event_properties": {
                "content_id": contentid,
                "title": title,
                "playhead": playhead,
            }
        })
    }).encode()
    return {
        "name": "Amplitude",
        "method": "POST",
        "url": "https://api2.amplitude.com/httpapi",
        "body": payload,
        "headers": {"Content-Type": "application/x-www-form-urlencoded"},
    }


ENDPOINTS = {
    "conviva":   build_conviva,
    "nielsen":   build_nielsen,
    "comscore":  build_comscore,
    "newrelic":  build_newrelic,
    "ga4":       build_ga4,
    "segment":   build_segment,
    "amplitude": build_amplitude,
}


# --- Fire ---

@dataclass
class PingResult:
    name: str
    url: str
    method: str
    status: int
    latency_ms: float
    response_body: str
    error: str = ""

COOKIES = ""

def ping(endpoint_def: dict) -> PingResult:
    req = urllib.request.Request(
        url=endpoint_def["url"],
        data=endpoint_def["body"],
        method=endpoint_def["method"],
        headers=endpoint_def["headers"],
    )
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
    if COOKIES:
        req.add_header("Cookie", COOKIES)

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            latency = (time.perf_counter() - t0) * 1000
            body = resp.read(2048).decode("utf-8", errors="replace")
            return PingResult(
                name=endpoint_def["name"],
                url=endpoint_def["url"][:120],
                method=endpoint_def["method"],
                status=resp.status,
                latency_ms=round(latency, 1),
                response_body=body[:500],
            )
    except urllib.error.HTTPError as e:
        latency = (time.perf_counter() - t0) * 1000
        body = e.read(512).decode("utf-8", errors="replace")
        return PingResult(
            name=endpoint_def["name"],
            url=endpoint_def["url"][:120],
            method=endpoint_def["method"],
            status=e.code,
            latency_ms=round(latency, 1),
            response_body=body,
        )
    except Exception as ex:
        latency = (time.perf_counter() - t0) * 1000
        return PingResult(
            name=endpoint_def["name"],
            url=endpoint_def["url"][:120],
            method=endpoint_def["method"],
            status=0,
            latency_ms=round(latency, 1),
            response_body="",
            error=str(ex),
        )


def print_result(r: PingResult):
    ok = "OK" if 200 <= r.status < 300 or r.status == 204 else "FAIL"
    status_str = str(r.status) if r.status else "ERR"
    print(f"\n{'='*60}")
    print(f"  [{ok}]  {r.name}")
    print(f"        {r.method} {r.url}")
    print(f"        Status : {status_str}   Latency: {r.latency_ms}ms")
    if r.error:
        print(f"        Error  : {r.error}")
    elif r.response_body:
        print(f"        Body   : {r.response_body[:200]}")


def main():
    parser = argparse.ArgumentParser(description="Tethernet telemetry ping harness")
    parser.add_argument("--endpoint", default="all", choices=list(ENDPOINTS.keys()) + ["all"])
    parser.add_argument("--title",     default=None, help="Override title")
    parser.add_argument("--playhead",  type=int, default=None, help="Playhead position in seconds")
    parser.add_argument("--userid",    default=None, help="Override user ID")
    parser.add_argument("--contentid", default=None, help="Override content ID")
    parser.add_argument("--cookies",   default=None, help="Raw Cookie header string")
    args = parser.parse_args()

    global COOKIES
    if args.cookies:
        COOKIES = args.cookies

    ts        = int(time.time() * 1000)
    title     = args.title     or random.choice(TITLES)
    playhead  = args.playhead  or random.randint(30, 3600)
    userid    = args.userid    or random.randint(10000000, 99999999)
    contentid = args.contentid or random.choice(CONTENT_IDS)
    sessionid = rand_session_id()

    print(f"\nTethernet Telemetry Ping Harness")
    print(f"  Title    : {title}")
    print(f"  Playhead : {playhead}s")
    print(f"  User ID  : {userid}")
    print(f"  Content  : {contentid}")
    print(f"  Session  : {sessionid}")
    print(f"  TS       : {ts}")

    targets = list(ENDPOINTS.keys()) if args.endpoint == "all" else [args.endpoint]

    results = []
    for key in targets:
        ep = ENDPOINTS[key](playhead, userid, contentid, title, sessionid, ts)
        result = ping(ep)
        print_result(result)
        results.append(result)

    print(f"\n{'='*60}")
    print(f"SUMMARY: {len(results)} endpoint(s)")
    for r in results:
        ok = "OK  " if 200 <= r.status < 300 or r.status == 204 else "FAIL"
        print(f"  [{ok}]  {r.name:<25} {str(r.status) if r.status else 'ERR':<6}  {r.latency_ms}ms")
    print()


if __name__ == "__main__":
    main()
