from app.services.passwords import hash_password, verify_password


def test_password_hash_roundtrip() -> None:
    password_hash = hash_password("Admin@123456")

    assert password_hash.startswith("pbkdf2_sha256$")
    assert verify_password("Admin@123456", password_hash)


def test_password_hash_rejects_wrong_password() -> None:
    password_hash = hash_password("Admin@123456")

    assert not verify_password("wrong-password", password_hash)
    assert not verify_password("Admin@123456", None)
