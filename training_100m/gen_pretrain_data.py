import json
import random

SYSTEM_MSG = "M3S_SWARM_CORE_ROUTER_V1"

# Vocabulary & Attributes
MINERS = ["M1", "M2", "M3", "M4"]
COURIERS = ["C1", "C2"]
SCOUTS = ["S1", "S2"]
ORES = ["ORE_DIAMOND", "ANCIENT_DEBRIS", "ORE_IRON", "ORE_GOLD"]
WEAPONS = ["END_CRYSTAL", "RESPAWN_ANCHOR", "NETHERITE_SWORD", "BOW_RANGED"]

def gen_cot_mining():
    m = random.choice(MINERS)
    ore = random.choice(ORES)
    count = random.randint(4, 28)
    y = random.choice([-58, -54, -50, 12, 16])
    hp = random.choice(["HP_FULL", "HP_LOW"])
    idle_miners = [x for x in MINERS if x != m]
    helper = random.choice(idle_miners)
    courier = random.choice(COURIERS)

    sit = f"SIT:{m}_{ore}_COUNT{count}_Y{y}_{hp}:{helper}_IDLE:{courier}_IDLE"

    # Chain-of-Thought
    if ore in ["ORE_DIAMOND", "ANCIENT_DEBRIS"] or count >= 16:
        thk = f"THK:HIGH_VALUE_DEPOSIT_DETECTED:DISPATCH_SUPPORT_{helper}:PREPARE_COURIER_{courier}"
        act = f"ACT:SUPP_MINE:{helper}->{m}|DISPATCH_COURIER:{courier}->{m}"
    elif count >= 8:
        thk = f"THK:STANDARD_VEIN_SOLO_MINE:DISPATCH_LOGISTICS_{courier}"
        act = f"ACT:DISPATCH_COURIER:{courier}->{m}"
    else:
        thk = f"THK:LOW_DENSITY_VEIN:NO_SWARM_ASSIST_NEEDED"
        act = f"ACT:SOLO_HARVEST:{m}"

    return sit, thk, act

def gen_cot_ambush():
    victim = random.choice(MINERS + COURIERS)
    weapon = random.choice(WEAPONS)
    hp = random.choice(["HP_CRITICAL", "HP_LOW"])
    allies = [x for x in MINERS + SCOUTS if x != victim]
    nearby = random.choice(allies)

    sit = f"SIT:{victim}_AMBUSH_{weapon}_{hp}:{nearby}_RADIUS35"

    if weapon in ["END_CRYSTAL", "RESPAWN_ANCHOR"] or hp == "HP_CRITICAL":
        thk = f"THK:LETHAL_EXPLOSIVE_OR_FATAL_HP:HARD_DEFENSE_TRIGGERED:SCATTER_ALLIED_UNITS"
        act = f"ACT:SELF_ENTOMB:{victim}|SCATTER_EVAC:{nearby}"
    else:
        thk = f"THK:CONVENTIONAL_MELEE_ATTACK:COVER_FIRE_REQUIRED"
        act = f"ACT:TACTICAL_RETREAT:{victim}|DIVERSION_ARROW:{nearby}"

    return sit, thk, act

def gen_cot_logistics():
    m = random.choice(MINERS)
    y = random.choice([-58, -50, 11])
    c = random.choice(COURIERS)
    c_status = random.choice(["IDLE", "BUSY"])

    sit = f"SIT:{m}_INV_FULL_Y{y}:{c}_{c_status}"

    if c_status == "IDLE":
        thk = f"THK:STORAGE_CAPACITY_REACHED:TRIGGER_DROP_CHEST:ASSIGN_CARGO_{c}"
        act = f"ACT:DROP_CHEST:{m}|FETCH_CARGO:{c}->{m}"
    else:
        thk = f"THK:ALL_COURIERS_OCCUPIED:CONCEAL_CARGO_TEMPORARY"
        act = f"ACT:STASH_COVERT:{m}|SNEAK_CAMOUFLAGE:{m}"

    return sit, thk, act

def gen_cot_fortify():
    s = random.choice(SCOUTS)
    dist = random.choice([25, 45, 75])
    b1 = random.choice(MINERS)
    b2 = random.choice(MINERS)

    sit = f"SIT:{s}_HOSTILE_PROXIMITY{dist}:BASE_{b1}_{b2}"

    if dist <= 30:
        thk = f"THK:CRITICAL_PROXIMITY_IMMINENT_BREACH:SEAL_STRONGHOLD"
        act = f"ACT:LOCKDOWN_BASE:{b1},{b2}|SNEAK_CAMOUFLAGE:{s}"
    else:
        thk = f"THK:ENEMY_SCOUTING_OUTER_PERIMETER:OBSIDIAN_BLAST_SHIELDING"
        act = f"ACT:FORTIFY_OBSIDIAN:{b1}|SNEAK_CAMOUFLAGE:{s}"

    return sit, thk, act

# Generate 20,000 samples for 105M model training
DATASET = []
for _ in range(7000):
    s, t, a = gen_cot_mining()
    text = f"<BOS>{s} {t} {a}<EOS>"
    DATASET.append({"text": text})

for _ in range(6000):
    s, t, a = gen_cot_ambush()
    text = f"<BOS>{s} {t} {a}<EOS>"
    DATASET.append({"text": text})

for _ in range(4500):
    s, t, a = gen_cot_logistics()
    text = f"<BOS>{s} {t} {a}<EOS>"
    DATASET.append({"text": text})

for _ in range(2500):
    s, t, a = gen_cot_fortify()
    text = f"<BOS>{s} {t} {a}<EOS>"
    DATASET.append({"text": text})

random.shuffle(DATASET)

out_path = "/opt/data/workspace/m3s_ai_100m/m3s_105m_pretrain.jsonl"
with open(out_path, "w", encoding="utf-8") as f:
    for item in DATASET:
        f.write(json.dumps(item) + "\n")

print(f"GENERATED {len(DATASET)} COGNITIVE DATASET SAMPLES FOR 105M MODEL AT {out_path}")
