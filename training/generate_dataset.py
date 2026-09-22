import json
import random

SYSTEM_PROMPT = "You are the M3S Swarm Commander SLM. You receive a compressed tactical situational state (SIT) and must output strictly the exact Swarm Action Protocol (ACT) with zero explanation."

# Entities & Attributes
MINERAL_TYPES = ["DIAMOND", "ANCIENT_DEBRIS", "IRON", "GOLD", "EMERALD", "REDSTONE", "COAL"]
ENEMY_WEAPONS = ["NETHERITE_SWORD", "END_CRYSTAL", "RESPAWN_ANCHOR", "BOW", "CROSSBOW", "AXE"]

def generate_ore_scenario():
    miner = random.choice(["M1", "M2", "M3"])
    ore = random.choice(MINERAL_TYPES)
    count = random.randint(4, 24)
    y_lvl = random.choice([-58, -54, -50, 12, 16])
    hp = random.randint(14, 20)
    idle_bots = [b for b in ["M2", "M3", "M4", "C1"] if b != miner]
    helper = random.choice(idle_bots)
    courier = "C1" if "C1" in idle_bots else "C2"

    sit = f"SIT:{miner}_ORE_{ore}_x{count}_Y{y_lvl}_HP{hp}:{helper}_IDLE_Y{y_lvl+2}:{courier}_IDLE_Y64"

    if ore in ["DIAMOND", "ANCIENT_DEBRIS"] or count >= 16:
        act = f"ACT:SUPP_MINE:{helper}->{miner}|DISPATCH_COURIER:{courier}->{miner}"
    elif count >= 8:
        act = f"ACT:DISPATCH_COURIER:{courier}->{miner}"
    else:
        act = f"ACT:SOLO_HARVEST:{miner}"

    return sit, act

def generate_ambush_scenario():
    victim = random.choice(["M1", "M2", "C1"])
    enemy_weapon = random.choice(ENEMY_WEAPONS)
    enemy_count = random.choice([1, 2, 3])
    hp = random.randint(4, 12)
    allies = [b for b in ["M2", "M3", "M4", "S1"] if b != victim]
    nearby_ally = random.choice(allies)

    sit = f"SIT:{victim}_AMBUSH_{enemy_weapon}_x{enemy_count}_HP{hp}:{nearby_ally}_STANDBY_R40:THREAT_CRITICAL"

    if enemy_weapon in ["END_CRYSTAL", "RESPAWN_ANCHOR"] or enemy_count >= 2:
        act = f"ACT:SELF_ENTOMB:{victim}|SCATTER_EVAC:{nearby_ally}"
    elif hp <= 6:
        act = f"ACT:SELF_ENTOMB:{victim}|DIVERSION_ARROW:{nearby_ally}"
    else:
        act = f"ACT:TACTICAL_RETREAT:{victim}|FLANK_COVER:{nearby_ally}"

    return sit, act

def generate_logistics_scenario():
    miner = random.choice(["M1", "M2", "M3"])
    slots_full = random.randint(18, 27)
    y_lvl = random.choice([-58, -40, 11])
    courier = random.choice(["C1", "C2"])
    courier_status = random.choice(["IDLE_SURFACE", "BUSY_TRANSIT", "INVENTORY_EMPTY"])

    sit = f"SIT:{miner}_INV_FULL_{slots_full}SLOTS_Y{y_lvl}:{courier}_{courier_status}"

    if courier_status != "BUSY_TRANSIT":
        act = f"ACT:DROP_CHEST:{miner}|FETCH_CARGO:{courier}->{miner}"
    else:
        act = f"ACT:STASH_COVERT:{miner}|STANDBY_UNTIL_COURIER_FREE"

    return sit, act

def generate_base_fortify_scenario():
    scout = "S1"
    hostile_dist = random.randint(30, 70)
    builder1 = random.choice(["M1", "M2"])
    builder2 = random.choice(["M3", "M4"])

    sit = f"SIT:{scout}_SCOUT_ENEMY_APPROACH_D{hostile_dist}:{builder1}_BASE_Y60:{builder2}_BASE_Y60"

    if hostile_dist <= 40:
        act = f"ACT:LOCKDOWN_BASE:{builder1},{builder2}|SNEAK_CAMOUFLAGE:{scout}"
    else:
        act = f"ACT:FORTIFY_OBSIDIAN:{builder1}|STANDBY_ALARM:{scout}"

    return sit, act

# Generate 6,000 samples
DATASET = []
generators = [
    (generate_ore_scenario, 2000),
    (generate_ambush_scenario, 1800),
    (generate_logistics_scenario, 1400),
    (generate_base_fortify_scenario, 800)
]

for gen_func, count in generators:
    for _ in range(count):
        sit, act = gen_func()
        entry = {
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": sit},
                {"role": "assistant", "content": act}
            ]
        }
        DATASET.append(entry)

random.shuffle(DATASET)

out_file = "/opt/data/workspace/m3s_ai_training/m3s_swarm_dsl_train.jsonl"
with open(out_file, "w", encoding="utf-8") as f:
    for d in DATASET:
        f.write(json.dumps(d) + "\n")

print(f"GENERATED {len(DATASET)} DATASET SAMPLES AT {out_file}")
