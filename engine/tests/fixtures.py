"""Test fixtures: the Taylor-Ashe (GenIns) paid triangle (Story 2.2).

Checked in as a plain constant so the golden tests do not depend on
``cl.load_sample`` (which reads package CSV files — fine in tests, but
the pinned values must live in this repo).
test_golden_taylor_ashe.py cross-checks this constant against
``cl.load_sample("genins")`` once, proving it wasn't fat-fingered.
"""

from reserving_engine import Triangle

TAYLOR_ASHE = Triangle(
    kind="paid",
    origin_periods=(
        "2001", "2002", "2003", "2004", "2005",
        "2006", "2007", "2008", "2009", "2010",
    ),
    development_periods=(
        "12", "24", "36", "48", "60", "72", "84", "96", "108", "120",
    ),
    cells=(
        (357848.0, 1124788.0, 1735330.0, 2218270.0, 2745596.0,
         3319994.0, 3466336.0, 3606286.0, 3833515.0, 3901463.0),
        (352118.0, 1236139.0, 2170033.0, 3353322.0, 3799067.0,
         4120063.0, 4647867.0, 4914039.0, 5339085.0, None),
        (290507.0, 1292306.0, 2218525.0, 3235179.0, 3985995.0,
         4132918.0, 4628910.0, 4909315.0, None, None),
        (310608.0, 1418858.0, 2195047.0, 3757447.0, 4029929.0,
         4381982.0, 4588268.0, None, None, None),
        (443160.0, 1136350.0, 2128333.0, 2897821.0, 3402672.0,
         3873311.0, None, None, None, None),
        (396132.0, 1333217.0, 2180715.0, 2985752.0, 3691712.0,
         None, None, None, None, None),
        (440832.0, 1288463.0, 2419861.0, 3483130.0, None,
         None, None, None, None, None),
        (359480.0, 1421128.0, 2864498.0, None, None,
         None, None, None, None, None),
        (376686.0, 1363294.0, None, None, None,
         None, None, None, None, None),
        (344014.0, None, None, None, None,
         None, None, None, None, None),
    ),
)
