#!/usr/bin/env python3
"""
Offline script to recompute slot priors from database prediction records

Usage:
    python scripts/recompute_slot_priors.py [--limit N] [--hours H]
"""

import sys
import argparse
from pathlib import Path

# Add parent directory to path (synchronizer folder)
script_dir = Path(__file__).parent
synchronizer_dir = script_dir.parent
sys.path.insert(0, str(synchronizer_dir))

from slot_prior_model import SlotPriorModel
from prediction_server import PredictionDatabase


def main():
    parser = argparse.ArgumentParser(description='Recompute slot priors from database')
    parser.add_argument('--limit', type=int, default=10000, 
                       help='Maximum number of records to process (default: 10000)')
    parser.add_argument('--hours', type=int, default=24,
                       help='Only process records from last N hours (default: 24)')
    parser.add_argument('--db-path', type=str, default=None,
                       help='Path to database file (default: predictions.db in script dir)')
    
    args = parser.parse_args()
    
    # Initialize database
    if args.db_path:
        db_path = Path(args.db_path)
    else:
        script_dir = Path(__file__).parent.parent
        db_path = script_dir / "predictions.db"
    
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        return 1
    
    print(f"Loading database: {db_path}")
    db = PredictionDatabase(db_path)
    
    # Create slot prior model
    model = SlotPriorModel(threshold=0.5)
    
    # Get recent predictions
    print(f"Loading up to {args.limit} recent predictions...")
    records = db.get_recent_predictions(limit=args.limit)
    
    if not records:
        print("No prediction records found in database")
        return 1
    
    print(f"Processing {len(records)} records...")
    
    # Update model from records
    model.update_from_db_records(records)
    
    if model.is_ready():
        print(f"\n✓ Slot priors computed successfully")
        print(f"  Sample count: {model.sample_count}")
        print(f"  Active slots: {sum(1 for p in model.p_onset if p > 0.5)}")
        print(f"\nOnset probabilities (first 16 slots):")
        for i in range(16):
            p, dur, conf = model.get_prior(i)
            print(f"  Slot {i:2d}: P={p:.3f}, Dur={dur}, Conf={conf:.3f}")
    else:
        print("Error: Failed to compute slot priors")
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

