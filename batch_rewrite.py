import os, sys, json, time

sys.path.insert(0, os.path.expanduser("~/paper_rewriter_langgraph"))
from agent.rewrite_graph import run_rewrite

PDF_DIR = r"C:\Users\Administrator\AppData\Local\Temp\transformer_papers"
OUTPUT_DIR = os.path.expanduser("~/paper_rewriter_langgraph/runs/batch_transformer")
os.makedirs(OUTPUT_DIR, exist_ok=True)

papers = [
    {"file": "1_Complementary_Attention_Head_Pruning_2606.19150", "title": "Complementary Attention Head Pruning for Efficient Transformers", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "2_Loop_Transformers_Residual_Scaling_2606.18524", "title": "On the Residual Scaling of Looped Transformers: Stability and Transferability", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "3_Expressivity_Hierarchical_Deep_Transformers_2606.17522", "title": "An Expressivity Analysis of Hierarchical Modelling in Deep Transformers via Bounded-Depth Grammars", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "4_Better_Queries_Cheaper_Attention_2606.17631", "title": "Better Queries, Cheaper Attention: Adapting Transformers for Efficient Sparse Reconstruction", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "5_CoT_State_Tracking_Solvable_Transformer_2606.18164", "title": "Learning Dynamics of Chain-of-Thought State Tracking in a Solvable Transformer Model", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "6_DiscreteLog_Clock_Modular_Multiplication_2606.17399", "title": "The Discrete-Log Clock: How a Transformer Learns Modular Multiplication", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "7_OneRank_Transformer_Native_Ranking_2606.16838", "title": "OneRank: Unified Transformer-Native Ranking Architecture for Multi-Task Recommendation", "audience": "计算机专业大学生，了解基本深度学习概念"},
    {"file": "8_Tree_Traversal_Transformer_Grammars_2606.16836", "title": "Does Traversal Order Matter? A Systematic Study of Tree Traversal Methods in Transformer Grammars", "audience": "计算机专业大学生，了解基本深度学习概念"},
]

progress_file = os.path.join(OUTPUT_DIR, "progress.json")
progress = {}
if os.path.exists(progress_file):
    with open(progress_file, "r", encoding="utf-8") as f:
        progress = json.load(f)

for i, paper in enumerate(papers):
    fname = paper["file"]
    if progress.get(fname) == "done":
        print(f"[{i+1}/8] SKIP {fname} (already done)")
        continue
    txt_path = os.path.join(PDF_DIR, fname + ".txt")
    if not os.path.exists(txt_path):
        print(f"[{i+1}/8] SKIP {fname} (no text file)")
        continue
    with open(txt_path, "r", encoding="utf-8") as f:
        original_text = f.read()
    print(f"[{i+1}/8] START {fname} ({len(original_text)} chars)")
    t0 = time.time()
    try:
        run_id = run_rewrite(paper_title=paper["title"], original_text=original_text, target_audience=paper["audience"], run_id=f"batch_{fname}", max_retries=2)
        elapsed = time.time() - t0
        print(f"[{i+1}/8] DONE {fname} in {elapsed:.0f}s, run_id={run_id}")
        progress[fname] = "done"
    except Exception as e:
        elapsed = time.time() - t0
        print(f"[{i+1}/8] FAIL {fname} after {elapsed:.0f}s: {e}")
        progress[fname] = f"error: {str(e)[:200]}"
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)

print("\n=== BATCH COMPLETE ===")
for k, v in progress.items():
    print(f"  {k}: {v}")
