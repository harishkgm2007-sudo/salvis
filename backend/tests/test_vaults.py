from tests.test_auth import _auth_headers, _register


def test_vault_create_list_deposit_complete(client):
    _register(client)
    h = _auth_headers(client)

    created = client.post(
        "/api/vaults",
        json={"title": "Laptop", "target_amount": 1000, "category": "tech"},
        headers=h,
    )
    assert created.status_code == 201, created.text
    vid = created.json()["id"]

    listed = client.get("/api/vaults", headers=h)
    assert len(listed.json()) == 1

    # Partial deposit keeps it active.
    client.post(f"/api/vaults/{vid}/deposit", json={"amount": 600}, headers=h)
    vault = client.get(f"/api/vaults/{vid}", headers=h).json()
    assert vault["current_amount"] == 600
    assert vault["status"] == "active"

    # Deposit that crosses the target auto-completes the vault.
    client.post(f"/api/vaults/{vid}/deposit", json={"amount": 500}, headers=h)
    vault = client.get(f"/api/vaults/{vid}", headers=h).json()
    assert vault["current_amount"] == 1100
    assert vault["status"] == "completed"
    assert vault["completed_at"] is not None

    # Withdrawing below target reactivates it.
    client.post(f"/api/vaults/{vid}/withdraw", json={"amount": 300}, headers=h)
    vault = client.get(f"/api/vaults/{vid}", headers=h).json()
    assert vault["status"] == "active"
    assert vault["completed_at"] is None


def test_vault_withdraw_limit_enforced(client):
    _register(client)
    h = _auth_headers(client)
    created = client.post("/api/vaults", json={"title": "Bag", "target_amount": 100}, headers=h).json()

    over = client.post(f"/api/vaults/{created['id']}/withdraw", json={"amount": 50}, headers=h)
    assert over.status_code == 400


def test_vault_soft_delete(client):
    _register(client)
    h = _auth_headers(client)
    vid = client.post("/api/vaults", json={"title": "Xbox", "target_amount": 400}, headers=h).json()["id"]

    client.delete(f"/api/vaults/{vid}", headers=h)
    assert client.get("/api/vaults", headers=h).json() == []
    assert client.get(f"/api/vaults/{vid}", headers=h).status_code == 404


def test_transactions_recorded(client):
    _register(client)
    h = _auth_headers(client)
    vid = client.post("/api/vaults", json={"title": "Camera", "target_amount": 300}, headers=h).json()["id"]

    client.post(f"/api/vaults/{vid}/deposit", json={"amount": 100, "note": "first"}, headers=h)
    client.post(f"/api/vaults/{vid}/deposit", json={"amount": 50, "note": "second"}, headers=h)

    txs = client.get("/api/transactions", headers=h).json()
    assert len(txs) == 2
    assert txs[0]["balance_after"] == 150