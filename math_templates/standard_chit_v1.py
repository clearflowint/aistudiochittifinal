import sys
import json

def calculate():
    try:
        input_data = json.load(sys.stdin)
        t = int(input_data.get("t", 1))
        N = int(input_data.get("N", 20))
        U = float(input_data.get("U", 5000))
        D = float(input_data.get("D", 6000))
        F = float(input_data.get("F", 2000))
        win_month = input_data.get("win_month", None)

        # Spawning Payout Formula for month t
        # Payout_t = [(t - 1) * (D - U)] + (N * U) - F
        payout = ((t - 1) * (D - U)) + (N * U) - F

        # Determine due for current month (drawn due starts from following month of drawn month)
        is_drawn = win_month is not None and t > int(win_month)
        current_due = D if is_drawn else U

        result = {
            "formula_id": "standard_chit_v1",
            "t": t,
            "payout": payout,
            "current_due": current_due,
            "is_drawn": is_drawn
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    calculate()
