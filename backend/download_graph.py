import osmnx as ox
import pickle
from pathlib import Path
import sys

def download_and_save_graph(place_name="Chiang Rai, Thailand", output_filename="chiang_rai_graph.pkl", network_type="drive"):
    # Path to the root workspace (one level up from backend/)
    ROOT = Path(__file__).parent.parent
    PKL_PATH = ROOT / output_filename
    
    print("="*60)
    print(f"🌍 FloodNav Routing Graph Generator")
    print("="*60)
    print(f"📥 Downloading road network for: {place_name}")
    print(f"⏳ This may take 2-5 minutes depending on the region size...")
    
    try:
        # Use OSMnx to download the graph
        G = ox.graph_from_place(place_name, network_type=network_type, simplify=True)
        
        # Save to pickle
        print(f"💾 Saving graph to: {PKL_PATH}")
        with open(PKL_PATH, 'wb') as f:
            pickle.dump(G, f)
            
        print(f"✅ Success! Graph saved with {G.number_of_nodes():,} nodes and {G.number_of_edges():,} edges.")
        print(f"🚀 You can now restart the FastAPI server!")
        
    except Exception as e:
        print(f"❌ Error generating graph: {e}")
        sys.exit(1)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate routing graph using OSMnx")
    parser.add_argument("--place", type=str, default="Chiang Rai, Thailand", help="Place name (e.g. 'Bangkok, Thailand')")
    parser.add_argument("--out", type=str, default="chiang_rai_graph.pkl", help="Output file name")
    args = parser.parse_args()
    
    download_and_save_graph(args.place, args.out)
