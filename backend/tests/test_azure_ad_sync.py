from types import SimpleNamespace

from app.services.azure_ad_sync import resolve_client_secret, role_for_job_title


def test_role_for_job_title_maps_executives() -> None:
    assert role_for_job_title("Chief Technology Officer", {"Chief": "EXECUTIVE"}) == "EXECUTIVE"
    assert role_for_job_title("VP Engineering", {"VP": "EXECUTIVE"}) == "EXECUTIVE"


def test_role_for_job_title_maps_department_managers() -> None:
    mapping = {"Manager": "DEPARTMENT_MANAGER", "Lead": "DEPARTMENT_MANAGER"}

    assert role_for_job_title("Engineering Manager", mapping) == "DEPARTMENT_MANAGER"
    assert role_for_job_title("Team Lead", mapping) == "DEPARTMENT_MANAGER"


def test_role_for_job_title_defaults_to_employee() -> None:
    assert role_for_job_title(None, {"Chief": "EXECUTIVE"}) == "EMPLOYEE"
    assert role_for_job_title("Unmapped Title", {"Chief": "EXECUTIVE"}) == "EMPLOYEE"


def test_resolve_client_secret_uses_env_var(monkeypatch) -> None:
    monkeypatch.setenv("AZURE_AD_CLIENT_SECRET", "secret-from-env")

    assert (
        resolve_client_secret(
            SimpleNamespace(
                client_secret_ref="AZURE_AD_CLIENT_SECRET",
                encrypted_client_secret=None,
            )
        )
        == "secret-from-env"
    )


def test_resolve_client_secret_treats_invalid_env_var_name_as_secret() -> None:
    assert (
        resolve_client_secret(
            SimpleNamespace(
                client_secret_ref="WNt8Q~direct-secret",
                encrypted_client_secret=None,
            )
        )
        == "WNt8Q~direct-secret"
    )
