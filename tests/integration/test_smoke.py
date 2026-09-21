"""S3.0: nothing Python here had ever run. This is the first test that does."""
from custom_components.floorplan_studio import const


def test_domain_is_the_integration_folder_name():
    assert const.DOMAIN == "floorplan_studio"
