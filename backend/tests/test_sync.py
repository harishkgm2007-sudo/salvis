from datetime import datetime, timedelta, timezone

from tests.test_auth import _auth_headers, _register


def test_snapshot_contains_api_created_data(client):
    _register(client)
    h = _auth_headers(client)
    client.post("/api/vaults", json={"title": "From API", "target_amount": 500}, headers=h)
    client.post("/api/profiles", json={"profile_name": "Family", "profile_type": "family"}, headers=h)

    snap = client.get("/api/sync/snapshot", headers=h)
    assert snap.status_code == 200
    data = snap.json()
    assert len(data["vaults"]) == 1
    assert len(data["profiles"]) == 1


def test_merge_incoming_client_vault(client):
    _register(client)
    h = _auth_headers(client)
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()

    resp = client.post(
        "/api/sync/merge",
        json={
            "device_id": "dev-1",
            "vaults": [
                {
                    "id": "vault-offline-1",
                    "title": "Offline Vault",
                    "target_amount": 200,
                    "current_amount": 50,
                    "status": "active",
                    "updated_at": future,
                }
            ],
            "transactions": [],
            "profiles": [],
            "bank_accounts": [],
        },
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"]["vaults"] == 1
    ids = [v["id"] for v in body["data"]["vaults"]]
    assert "vault-offline-1" in ids


def test_merge_last_write_wins_by_server_clock(client):
    _register(client)
    h = _auth_headers(client)
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()

    client.post(
        "/api/sync/merge",
        json={
            "device_id": "dev-2",
            "vaults": [{"id": "v-1", "title": "Fresh Title", "target_amount": 100, "status": "active", "updated_at": future}],
            "transactions": [],
            "profiles": [],
            "bank_accounts": [],
        },
        headers=h,
    )

    stale = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    resp = client.post(
        "/api/sync/merge",
        json={
            "device_id": "dev-2",
            "vaults": [{"id": "v-1", "title": "Stale Title", "target_amount": 999, "status": "active", "updated_at": stale}],
            "transactions": [],
            "profiles": [],
            "bank_accounts": [],
        },
        headers=h,
    )
    vault = next(v for v in resp.json()["data"]["vaults"] if v["id"] == "v-1")
    assert vault["title"] == "Fresh Title"
    assert vault["target_amount"] == 100