"""Who made each coin? Reads the creator wallet of pump.fun coins straight from Solana.

Every pump.fun coin has a "bonding curve" account whose address is derived from the coin's address;
bytes 49-81 of that account hold the creator's wallet. Coins from other launchpads are skipped.
"""
from __future__ import annotations

import base64
import logging
import time

import requests

log = logging.getLogger("creators")
RPC = "https://api.mainnet-beta.solana.com"
PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
SCHEMA = "create table if not exists creators (token text primary key, creator text);"


def bonding_curve(token: str) -> str:
    from solders.pubkey import Pubkey

    pda, _ = Pubkey.find_program_address([b"bonding-curve", bytes(Pubkey.from_string(token))], Pubkey.from_string(PUMP_PROGRAM))
    return str(pda)


def creator_from_account(data_b64: str) -> str | None:
    from solders.pubkey import Pubkey

    raw = base64.b64decode(data_b64)
    return str(Pubkey.from_bytes(raw[49:81])) if len(raw) >= 81 else None


def fetch_creators(db, batch: int = 100) -> int:
    """Look up creators for pump.fun coins we haven't checked yet. Returns how many were found."""
    db.executescript(SCHEMA)
    todo = [t for (t,) in db.execute("""select token from coins where dex in ('pump-fun', 'pumpswap')
                                        and token not in (select token from creators)""")]
    found = 0
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        try:
            r = requests.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "getMultipleAccounts",
                                         "params": [[bonding_curve(t) for t in chunk], {"encoding": "base64"}]}, timeout=60)
            values = r.json()["result"]["value"]
        except Exception as e:
            log.warning("creator lookup failed: %s", e)
            time.sleep(10)
            continue
        for token, acct in zip(chunk, values):
            creator = creator_from_account(acct["data"][0]) if acct else None
            db.execute("insert or replace into creators values (?, ?)", (token, creator))
            found += creator is not None
        db.commit()
        time.sleep(1)
    return found
