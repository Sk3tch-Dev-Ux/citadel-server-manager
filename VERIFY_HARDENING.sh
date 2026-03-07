#!/bin/bash
# Verification script for MOD SYSTEM hardening fixes
# Usage: ./VERIFY_HARDENING.sh

echo "=================================================================================="
echo "MOD SYSTEM HARDENING VERIFICATION SCRIPT"
echo "=================================================================================="
echo ""

BACKEND_DIR="./backend/lib"
DOCS_DIR="."

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter
PASSED=0
FAILED=0

# Function to check file exists
check_file() {
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $1 - NOT FOUND"
    ((FAILED++))
    return 1
  fi
}

# Function to check syntax
check_syntax() {
  if node -c "$1" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $1 - Syntax OK"
    ((PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $1 - Syntax ERROR"
    ((FAILED++))
    return 1
  fi
}

# Function to check for required functions
check_function() {
  if grep -q "function $2\|const $2 =" "$1" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} $1 contains $2()"
    ((PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $1 missing $2()"
    ((FAILED++))
    return 1
  fi
}

echo "CHECKING PRODUCTION CODE..."
echo "----------------------------"
echo ""

# mod-manager.js checks
echo "mod-manager.js:"
check_file "$BACKEND_DIR/mod-manager.js"
check_syntax "$BACKEND_DIR/mod-manager.js"
check_function "$BACKEND_DIR/mod-manager.js" "validateModInstallation"
check_function "$BACKEND_DIR/mod-manager.js" "installModToServer"
echo ""

# workshop.js checks
echo "workshop.js:"
check_file "$BACKEND_DIR/workshop.js"
check_syntax "$BACKEND_DIR/workshop.js"
check_function "$BACKEND_DIR/workshop.js" "checkRateLimit"
check_function "$BACKEND_DIR/workshop.js" "fetchWithRateLimit"
echo ""

# mod-cache.js checks
echo "mod-cache.js:"
check_file "$BACKEND_DIR/mod-cache.js"
check_syntax "$BACKEND_DIR/mod-cache.js"
check_function "$BACKEND_DIR/mod-cache.js" "isCacheExpired"
check_function "$BACKEND_DIR/mod-cache.js" "evictOldestEntries"
check_function "$BACKEND_DIR/mod-cache.js" "getCached"
check_function "$BACKEND_DIR/mod-cache.js" "storeInCache"
check_function "$BACKEND_DIR/mod-cache.js" "clearCache"
check_function "$BACKEND_DIR/mod-cache.js" "invalidateCacheEntry"
echo ""

# auto-updater.js checks
echo "auto-updater.js:"
check_file "$BACKEND_DIR/auto-updater.js"
check_syntax "$BACKEND_DIR/auto-updater.js"
check_function "$BACKEND_DIR/auto-updater.js" "journalStateTransition"
check_function "$BACKEND_DIR/auto-updater.js" "recoverInterruptedUpdates"
check_function "$BACKEND_DIR/auto-updater.js" "initAutoUpdater"
echo ""

echo "CHECKING DOCUMENTATION..."
echo "----------------------------"
echo ""

# Documentation checks
echo "Documentation Files:"
check_file "$DOCS_DIR/HARDENING_FIXES_SUMMARY.md"
check_file "$DOCS_DIR/MOD_SYSTEM_REFERENCE.md"
check_file "$DOCS_DIR/DEPLOYMENT_NOTES.txt"
echo ""

# Summary
echo "=================================================================================="
echo "VERIFICATION SUMMARY"
echo "=================================================================================="
TOTAL=$((PASSED + FAILED))
echo "Total Checks: $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ ALL CHECKS PASSED - SYSTEM READY FOR DEPLOYMENT${NC}"
  exit 0
else
  echo -e "${RED}✗ SOME CHECKS FAILED - PLEASE REVIEW${NC}"
  exit 1
fi
