"""Regression: Aden sync pruning must NOT delete locally-stored credentials.

A locally-collected / BYOK credential saved via ``LocalCredentialRegistry``
carries ``_integration_type`` (like Aden credentials do) but NOT the
``_aden_managed`` marker. The prune step used to key on ``_integration_type``
and therefore wiped every local account on the next Aden sync — the agentic
credential store would "lose" a key right after saving it. Prune must key on
``_aden_managed`` instead.
"""

from __future__ import annotations

from types import SimpleNamespace

from framework.credentials.aden.storage import AdenCachedStorage
from framework.credentials.models import CredentialObject
from framework.credentials.storage import InMemoryStorage


def _storage() -> tuple[AdenCachedStorage, InMemoryStorage]:
    local = InMemoryStorage()
    # prune_stale_aden_credentials never touches the provider, so a stub is fine.
    storage = AdenCachedStorage(local_storage=local, aden_provider=SimpleNamespace(), cache_ttl_seconds=300)
    return storage, local


def _aden_cred(cred_id: str, provider: str) -> CredentialObject:
    c = CredentialObject(id=cred_id)
    c.set_key("access_token", "tok")
    c.set_key("_integration_type", provider)
    c.set_key("_aden_managed", "true")
    return c


def _local_cred(cred_id: str, provider: str, alias: str) -> CredentialObject:
    # Mirrors LocalCredentialRegistry.save_account: _integration_type but no _aden_managed.
    c = CredentialObject(id=cred_id)
    c.set_key("api_key", "sk")
    c.set_key("_integration_type", provider)
    c.set_key("_alias", alias)
    c.set_key("_status", "active")
    return c


def test_prune_keeps_local_account_deletes_revoked_aden():
    storage, local = _storage()
    local.save(_aden_cred("hubspot:default:1:2", "hubspot"))
    local.save(_local_cred("stripe/default", "stripe", "default"))

    # Nothing active on the Aden side: the Aden cred is stale, the local one isn't.
    pruned = storage.prune_stale_aden_credentials(active_ids=set())

    assert pruned == 1
    assert local.load("stripe/default") is not None, "local account must survive prune"
    assert local.load("hubspot:default:1:2") is None, "revoked Aden cred should be pruned"


def test_prune_keeps_active_aden_and_local():
    storage, local = _storage()
    local.save(_aden_cred("hubspot:default:1:2", "hubspot"))
    local.save(_local_cred("stripe/default", "stripe", "default"))

    # Aden cred is still active → nothing pruned.
    pruned = storage.prune_stale_aden_credentials(active_ids={"hubspot:default:1:2"})

    assert pruned == 0
    assert local.load("stripe/default") is not None
    assert local.load("hubspot:default:1:2") is not None


def test_prune_deletes_legacy_aden_without_marker():
    """Legacy Aden creds (only _integration_type, no _aden_managed) still prune.

    Guards the regression the adversarial review caught: keying purely on
    _aden_managed would leave pre-marker Aden files undeletable on revocation.
    Their ids are opaque (no "/"), so the separator check doesn't spare them.
    """
    storage, local = _storage()
    legacy = CredentialObject(id="Z29vZ2xlOnJldm9rZWQ6OTk5")  # base64-style Aden id, no "/"
    legacy.set_key("access_token", "tok")
    legacy.set_key("_integration_type", "google")  # NO _aden_managed
    local.save(legacy)

    pruned = storage.prune_stale_aden_credentials(active_ids=set())

    assert pruned == 1
    assert local.load("Z29vZ2xlOnJldm9rZWQ6OTk5") is None


def test_prune_ignores_local_even_when_indexed():
    """A local cred that got into the provider index is still spared."""
    storage, local = _storage()
    loc = _local_cred("stripe/work", "stripe", "work")
    local.save(loc)
    # Simulate it having been indexed by provider name.
    storage._index_provider(loc)

    pruned = storage.prune_stale_aden_credentials(active_ids=set())

    assert pruned == 0
    assert local.load("stripe/work") is not None
