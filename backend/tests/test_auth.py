def _register(client, email="t@example.com", password="secret123"):
    return client.post(
        "/api/auth/register",
        json={"name": "Test User", "email": email, "password": password},
    )


def _auth_headers(client, email="t@example.com", password="secret123"):
    login = client.post("/api/auth/login", json={"identifier": email, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_register_login_me(client):
    r = _register(client)
    assert r.status_code == 201
    tokens = r.json()
    assert tokens["access_token"] and tokens["refresh_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "t@example.com"

    wrong = client.post("/api/auth/login", json={"identifier": "t@example.com", "password": "wrongpass"})
    assert wrong.status_code == 401


def test_duplicate_register_rejected(client):
    assert _register(client).status_code == 201
    assert _register(client).status_code == 409


def test_refresh_flow(client):
    tokens = _register(client).json()
    r = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["access_token"]

    # An access token is not a valid refresh token.
    bad = client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert bad.status_code == 401