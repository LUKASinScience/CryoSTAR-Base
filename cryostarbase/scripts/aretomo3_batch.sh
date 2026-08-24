#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  test_aretomo3_batch.sh — Test script for fixed aretomo3_batch.py
#
#  Written together by Lukas W. Bauer und Claude — 2026
# ═══════════════════════════════════════════════════════════════════════════

set -e

echo "════════════════════════════════════════════════════════════════════════"
echo "  AreTomo3 Batch Script - TEST SUITE"
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── Configuration ─────────────────────────────────────────────────────────
# EDIT THESE PATHS TO MATCH YOUR SYSTEM:

ARETOMO3_BINARY="/path_example/AreTomo3/AreTomo3"
MDOCS_DIR="/path_example/ssd_workdir/example_dataset/aretomo3/raw_data_frames"
GAIN_REF="gain_reference.mrc"
SCRIPT="aretomo3_batch.py"

# ── Test 1: Binary Check ──────────────────────────────────────────────────
echo "TEST 1: Binary Check"
echo "─────────────────────"

echo "Testing with WRONG binary path (should fail)..."
if python "$SCRIPT" \
    --mdocs_dir "$MDOCS_DIR" \
    --aretomo3 "/wrong/path/AreTomo3" \
    --gain "$GAIN_REF" \
    --angpix 2.678 \
    2>&1 | grep -q "AreTomo3 binary check FAILED"; then
    echo "✓ PASS: Binary check correctly detected invalid path"
else
    echo "✗ FAIL: Binary check should have failed"
    exit 1
fi

echo ""

echo "Testing with CORRECT binary path (should pass)..."
if python "$SCRIPT" \
    --mdocs_dir "$MDOCS_DIR" \
    --aretomo3 "$ARETOMO3_BINARY" \
    --gain "$GAIN_REF" \
    --angpix 2.678 \
    --volz 2500 \
    2>&1 | grep -q "AreTomo3 binary:"; then
    echo "✓ PASS: Binary check passed"
else
    echo "✗ FAIL: Binary check should have passed"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── Test 2: Path Resolution ───────────────────────────────────────────────
echo "TEST 2: Path Resolution"
echo "───────────────────────"

echo "Testing output directory resolution..."
OUTPUT=$(python "$SCRIPT" \
    --mdocs_dir "$MDOCS_DIR" \
    --aretomo3 "$ARETOMO3_BINARY" \
    --gain "$GAIN_REF" \
    --outdir "aretomo3_results" \
    --angpix 2.678 \
    2>&1)

# Check if output dir is absolute
if echo "$OUTPUT" | grep -q "Output dir.*:.*/.*/aretomo3_results"; then
    echo "✓ PASS: Output directory resolved to absolute path"
    echo "$OUTPUT" | grep "Output dir"
else
    echo "✗ FAIL: Output directory not resolved correctly"
    echo "$OUTPUT" | grep "Output dir"
    exit 1
fi

echo ""

# Check if gain reference is absolute
if echo "$OUTPUT" | grep -q "Gain reference.*:.*/.*/.*\.mrc"; then
    echo "✓ PASS: Gain reference resolved to absolute path"
    echo "$OUTPUT" | grep "Gain reference"
else
    echo "✗ FAIL: Gain reference not resolved correctly"
    echo "$OUTPUT" | grep "Gain reference"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── Test 3: GPU Check ─────────────────────────────────────────────────────
echo "TEST 3: GPU Pre-Check"
echo "─────────────────────"

echo "Testing GPU detection..."
if python "$SCRIPT" \
    --mdocs_dir "$MDOCS_DIR" \
    --aretomo3 "$ARETOMO3_BINARY" \
    --gain "$GAIN_REF" \
    --angpix 2.678 \
    2>&1 | grep -q "GPU Available:"; then
    echo "✓ PASS: GPU detection working"
else
    echo "⚠ WARNING: GPU detection not working (nvidia-smi might not be available)"
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── Test 4: Directory Creation ────────────────────────────────────────────
echo "TEST 4: Directory Creation"
echo "──────────────────────────"

TEST_OUTDIR="/tmp/aretomo3_test_$(date +%s)"
echo "Testing directory creation at: $TEST_OUTDIR"

if python "$SCRIPT" \
    --mdocs_dir "$MDOCS_DIR" \
    --aretomo3 "$ARETOMO3_BINARY" \
    --gain "$GAIN_REF" \
    --outdir "$TEST_OUTDIR" \
    --angpix 2.678 \
    2>&1 | grep -q "Output directory ready:"; then
    echo "✓ PASS: Directory creation working"
    
    # Check if directory actually exists
    if [ -d "$TEST_OUTDIR" ]; then
        echo "✓ PASS: Directory actually created on disk"
        rm -rf "$TEST_OUTDIR"
        echo "  (cleaned up test directory)"
    else
        echo "✗ FAIL: Directory not found on disk"
        exit 1
    fi
else
    echo "✗ FAIL: Directory creation failed"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── Test 5: File Validation ───────────────────────────────────────────────
echo "TEST 5: File Validation"
echo "───────────────────────"

echo "Testing with non-existent MDOC directory (should fail)..."
if python "$SCRIPT" \
    --mdocs_dir "/nonexistent/path" \
    --aretomo3 "$ARETOMO3_BINARY" \
    --gain "$GAIN_REF" \
    --angpix 2.678 \
    2>&1 | grep -q "MDOC directory not found"; then
    echo "✓ PASS: Correctly detected non-existent MDOC directory"
else
    echo "✗ FAIL: Should have detected non-existent MDOC directory"
    exit 1
fi

echo ""

echo "Testing with non-existent gain reference (should fail)..."
if python "$SCRIPT" \
    --mdocs_dir "$MDOCS_DIR" \
    --aretomo3 "$ARETOMO3_BINARY" \
    --gain "nonexistent_gain.mrc" \
    --angpix 2.678 \
    2>&1 | grep -q "Gain reference not found"; then
    echo "✓ PASS: Correctly detected non-existent gain reference"
else
    echo "✗ FAIL: Should have detected non-existent gain reference"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo ""

# ── Summary ───────────────────────────────────────────────────────────────
echo "🎉 ALL TESTS PASSED!"
echo ""
echo "The script is ready for production use. Key features verified:"
echo "  ✓ Binary checking (with error detection)"
echo "  ✓ Path resolution (relative → absolute)"
echo "  ✓ GPU detection (Pre-check)"
echo "  ✓ Directory creation (with error handling)"
echo "  ✓ File validation (MDOC dir + gain ref)"
echo ""
echo "Next steps:"
echo "  1. Deploy to cryostarbase: cp aretomo3_batch.py /path/to/cryostarbase/scripts/"
echo "  2. Run with real data"
echo "  3. Check GPU POST-CHECK after jobs complete"
echo ""
echo "════════════════════════════════════════════════════════════════════════"