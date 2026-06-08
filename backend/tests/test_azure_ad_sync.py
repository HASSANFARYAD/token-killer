from app.services.azure_ad_sync import role_for_job_title


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
