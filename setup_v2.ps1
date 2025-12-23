# setup_v2.ps1
# Creates the V2 "challenges" library folders + starter files (safe to re-run)

$ErrorActionPreference = "Stop"

# Use script folder if running as a file; otherwise fall back to current directory.
$root = $PSScriptRoot
if (-not $root -or $root.Trim().Length -eq 0) {
  $root = (Get-Location).Path
}

function Ensure-Dir($p) {
  if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function Write-File($path, $content) {
  $dir = Split-Path -Parent $path
  Ensure-Dir $dir
  Set-Content -Path $path -Value $content -Encoding UTF8
}

Write-Host "Creating challenge library under: $root"

# Folder structure
Ensure-Dir (Join-Path $root "challenges")
Ensure-Dir (Join-Path $root "challenges\sql")
Ensure-Dir (Join-Path $root "challenges\python")
Ensure-Dir (Join-Path $root "challenges\javascript")
Ensure-Dir (Join-Path $root "challenges\csharp")
Ensure-Dir (Join-Path $root "challenges\java")

# Per-session DB folder (server will write here)
Ensure-Dir (Join-Path $root "session_dbs")

# Index (catalog)
$indexJson = @'
{
  "version": 1,
  "notes": "Starter challenge catalog. Add more items as JSON files and reference here (optional).",
  "languages": ["sql","python","javascript","csharp","java"]
}
'@
Write-File (Join-Path $root "challenges\index.json") $indexJson

# SQL seed (deterministic dataset for per-session DB)
$sqlSeed = @'
-- challenges/sql/seed.sql
-- Deterministic seed data for interview challenges.
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS Customers;
DROP TABLE IF EXISTS Invoices;
DROP TABLE IF EXISTS Projects;

CREATE TABLE Customers (
  Id        INTEGER PRIMARY KEY,
  Name      TEXT NOT NULL,
  Email     TEXT,
  City      TEXT,
  State     TEXT,
  Country   TEXT,
  Industry  TEXT,
  IsActive  INTEGER NOT NULL DEFAULT 1,
  CreatedAt TEXT NOT NULL
);

CREATE TABLE Invoices (
  Id          INTEGER PRIMARY KEY,
  CustomerId  INTEGER NOT NULL,
  Amount      REAL NOT NULL,
  InvoiceDate TEXT NOT NULL,
  Status      TEXT NOT NULL,
  FOREIGN KEY(CustomerId) REFERENCES Customers(Id)
);

CREATE TABLE Projects (
  Id          INTEGER PRIMARY KEY,
  CustomerId  INTEGER NOT NULL,
  Name        TEXT NOT NULL,
  StartDate   TEXT NOT NULL,
  EndDate     TEXT,
  Status      TEXT NOT NULL,
  FOREIGN KEY(CustomerId) REFERENCES Customers(Id)
);

INSERT INTO Customers (Id, Name, Email, City, State, Country, Industry, IsActive, CreatedAt) VALUES
(1,'Acme Manufacturing','ops@acme-mfg.com','Denver','CO','USA','Manufacturing',1,'2023-01-15'),
(2,'Northwind Logistics','it@northwind-log.com','Seattle','WA','USA','Logistics',1,'2023-03-02'),
(3,'Global Retail Group','tech@gr-retail.com','Chicago','IL','USA','Retail',1,'2022-11-20'),
(4,'Pioneer Energy Services','info@pioneer-energy.io','Houston','TX','USA','Energy',1,'2022-09-05'),
(5,'Summit Financial Partners','admin@summit-fin.com','New York','NY','USA','Financial',1,'2023-05-10'),
(6,'BlueSky Health Systems','it@bluesky-health.com','San Diego','CA','USA','Healthcare',1,'2023-02-28'),
(7,'Vertex Construction Group','pm@vertex-build.com','Phoenix','AZ','USA','Construction',0,'2021-07-14'),
(8,'Aurora Tech Solutions','dev@aurora-tech.io','Austin','TX','USA','Technology',1,'2023-08-01');

INSERT INTO Invoices (Id, CustomerId, Amount, InvoiceDate, Status) VALUES
(1,1,12000.00,'2024-01-10','Paid'),
(2,1,5400.50,'2024-03-01','Paid'),
(3,2,2200.00,'2024-02-18','Open'),
(4,2,1800.00,'2024-03-19','Open'),
(5,3,9150.00,'2024-01-28','Paid'),
(6,3,1500.00,'2024-02-15','Void'),
(7,4,25000.00,'2024-03-05','Paid'),
(8,5,7700.00,'2024-02-01','Open'),
(9,6,3300.00,'2024-02-20','Paid'),
(10,8,6400.00,'2024-03-11','Open');

INSERT INTO Projects (Id, CustomerId, Name, StartDate, EndDate, Status) VALUES
(1,1,'ERP Upgrade','2024-01-01',NULL,'Active'),
(2,2,'Data Warehouse','2023-12-01',NULL,'Active'),
(3,3,'POS Refresh','2023-09-15','2024-02-28','Closed'),
(4,4,'Asset Tracking','2024-02-01',NULL,'Active'),
(5,8,'Mobile App','2024-01-20',NULL,'Active');
'@
Write-File (Join-Path $root "challenges\sql\seed.sql") $sqlSeed

# SQL Challenges
$sqlL1 = @'
{
  "id": "sql_l1_fix_select",
  "title": "Fix a broken SELECT",
  "language": "sql",
  "level": 1,
  "prompt": "Fix the query so it returns all customers in Texas (TX).",
  "starterCode": "SELECT * form Customers WHERE State = 'TX';",
  "notes": "Candidate should fix 'form' -> 'FROM'."
}
'@
Write-File (Join-Path $root "challenges\sql\L1_fix_select.json") $sqlL1

$sqlL2 = @'
{
  "id": "sql_l2_group_by",
  "title": "Group and count",
  "language": "sql",
  "level": 2,
  "prompt": "Return one row per State with a count of active customers (IsActive=1). Sort by count desc, then State asc.",
  "starterCode": "SELECT State, COUNT(*) AS ActiveCount\nFROM Customers\nWHERE IsActive = 1\nGROUP BY State\nORDER BY ActiveCount DESC, State ASC;"
}
'@
Write-File (Join-Path $root "challenges\sql\L2_group_by.json") $sqlL2

$sqlL3 = @'
{
  "id": "sql_l3_cte_invoice_totals",
  "title": "CTE + join (invoice totals)",
  "language": "sql",
  "level": 3,
  "prompt": "Return Customer Name and TotalOpenAmount (sum of invoice Amount where Status='Open'), but only for customers with TotalOpenAmount >= 5000. Sort by TotalOpenAmount desc.",
  "starterCode": "WITH OpenTotals AS (\n  SELECT CustomerId, SUM(Amount) AS TotalOpenAmount\n  FROM Invoices\n  WHERE Status = 'Open'\n  GROUP BY CustomerId\n)\nSELECT c.Name, o.TotalOpenAmount\nFROM OpenTotals o\nJOIN Customers c ON c.Id = o.CustomerId\nWHERE o.TotalOpenAmount >= 5000\nORDER BY o.TotalOpenAmount DESC;"
}
'@
Write-File (Join-Path $root "challenges\sql\L3_window_or_cte.json") $sqlL3

# Fibonacci challenges
$pyL1 = @'
{
  "id": "py_l1_fib_broken",
  "title": "Fix Fibonacci (broken base cases)",
  "language": "python",
  "level": 1,
  "prompt": "Fix the function so fib(0)=0, fib(1)=1 and fib(n) works for n>=0.",
  "starterCode": "def fib(n):\n    if n == 0:\n        return 1\n    if n == 1:\n        return 0\n    return fib(n-1) + fib(n-2)\n\nprint([fib(i) for i in range(10)])\n"
}
'@
Write-File (Join-Path $root "challenges\python\L1_fib_broken.json") $pyL1

$pyL2 = @'
{
  "id": "py_l2_fib_memo",
  "title": "Fibonacci with memoization",
  "language": "python",
  "level": 2,
  "prompt": "Implement fib(n) using memoization to avoid exponential recursion.",
  "starterCode": "def fib(n, memo=None):\n    # TODO: implement memoization\n    pass\n\nprint(fib(35))\n"
}
'@
Write-File (Join-Path $root "challenges\python\L2_fib_memo.json") $pyL2

$pyL3 = @'
{
  "id": "py_l3_fib_perf",
  "title": "Refactor Fibonacci for performance",
  "language": "python",
  "level": 3,
  "prompt": "Refactor fib(n) to be fast and safe for large n (e.g., n=100000). Return fib(n) modulo 1_000_000_007.",
  "starterCode": "MOD = 1_000_000_007\n\ndef fib_mod(n):\n    # TODO: fast implementation\n    pass\n\nprint(fib_mod(100000))\n"
}
'@
Write-File (Join-Path $root "challenges\python\L3_fib_perf.json") $pyL3

$jsL1 = @'
{
  "id": "js_l1_fib_broken",
  "title": "Fix Fibonacci (off-by-one)",
  "language": "javascript",
  "level": 1,
  "prompt": "Fix the function so fib(0)=0, fib(1)=1, fib(2)=1, ...",
  "starterCode": "function fib(n) {\n  if (n <= 1) return 1; // wrong\n  return fib(n-1) + fib(n-2);\n}\n\nconsole.log(Array.from({length: 10}, (_, i) => fib(i)));\n"
}
'@
Write-File (Join-Path $root "challenges\javascript\L1_fib_broken.json") $jsL1

$jsL2 = @'
{
  "id": "js_l2_fib_memo",
  "title": "Fibonacci with memoization",
  "language": "javascript",
  "level": 2,
  "prompt": "Implement fib(n) with memoization; avoid recomputation.",
  "starterCode": "function fib(n, memo = {}) {\n  // TODO\n}\n\nconsole.log(fib(40));\n"
}
'@
Write-File (Join-Path $root "challenges\javascript\L2_fib_memo.json") $jsL2

$jsL3 = @'
{
  "id": "js_l3_fib_perf",
  "title": "Fast Fibonacci modulo",
  "language": "javascript",
  "level": 3,
  "prompt": "Compute fib(n) modulo 1_000_000_007 for very large n (e.g., 100000).",
  "starterCode": "const MOD = 1_000_000_007;\nfunction fibMod(n) {\n  // TODO\n}\n\nconsole.log(fibMod(100000));\n"
}
'@
Write-File (Join-Path $root "challenges\javascript\L3_fib_perf.json") $jsL3

$csL1 = @'
{
  "id": "cs_l1_fib_broken",
  "title": "Fix Fibonacci (bad base cases)",
  "language": "csharp",
  "level": 1,
  "prompt": "Fix Fibonacci so fib(0)=0 and fib(1)=1.",
  "starterCode": "using System;\n\nclass Program {\n  static int Fib(int n) {\n    if (n == 0) return 1; // wrong\n    if (n == 1) return 0; // wrong\n    return Fib(n-1) + Fib(n-2);\n  }\n\n  static void Main() {\n    for (int i=0; i<10; i++) Console.Write(Fib(i) + (i<9 ? \",\" : \"\"));\n  }\n}\n"
}
'@
Write-File (Join-Path $root "challenges\csharp\L1_fib_broken.json") $csL1

$csL2 = @'
{
  "id": "cs_l2_fib_memo",
  "title": "Fibonacci with memoization",
  "language": "csharp",
  "level": 2,
  "prompt": "Implement Fibonacci using memoization (Dictionary) or DP.",
  "starterCode": "using System;\nusing System.Collections.Generic;\n\nclass Program {\n  static long Fib(int n, Dictionary<int,long> memo) {\n    // TODO\n    return 0;\n  }\n\n  static void Main() {\n    Console.WriteLine(Fib(40, new Dictionary<int,long>()));\n  }\n}\n"
}
'@
Write-File (Join-Path $root "challenges\csharp\L2_fib_memo.json") $csL2

$csL3 = @'
{
  "id": "cs_l3_fib_perf",
  "title": "Fast Fibonacci modulo",
  "language": "csharp",
  "level": 3,
  "prompt": "Compute fib(n) modulo 1_000_000_007 efficiently for large n (e.g., 100000).",
  "starterCode": "using System;\n\nclass Program {\n  const long MOD = 1_000_000_007;\n  static long FibMod(int n) {\n    // TODO\n    return 0;\n  }\n\n  static void Main() {\n    Console.WriteLine(FibMod(100000));\n  }\n}\n"
}
'@
Write-File (Join-Path $root "challenges\csharp\L3_fib_perf.json") $csL3

$javaL1 = @'
{
  "id": "java_l1_fib_broken",
  "title": "Fix Fibonacci (wrong return)",
  "language": "java",
  "level": 1,
  "prompt": "Fix Fibonacci so fib(0)=0 and fib(1)=1.",
  "starterCode": "public class Main {\n  static int fib(int n) {\n    if (n <= 1) return 1; // wrong\n    return fib(n-1) + fib(n-2);\n  }\n\n  public static void main(String[] args) {\n    for (int i=0; i<10; i++) {\n      System.out.print(fib(i));\n      if (i<9) System.out.print(\",\");\n    }\n  }\n}\n"
}
'@
Write-File (Join-Path $root "challenges\java\L1_fib_broken.json") $javaL1

$javaL2 = @'
{
  "id": "java_l2_fib_memo",
  "title": "Fibonacci with memoization",
  "language": "java",
  "level": 2,
  "prompt": "Implement Fibonacci using memoization (Map) or DP.",
  "starterCode": "import java.util.*;\n\npublic class Main {\n  static long fib(int n, Map<Integer,Long> memo) {\n    // TODO\n    return 0;\n  }\n\n  public static void main(String[] args) {\n    System.out.println(fib(40, new HashMap<>()));\n  }\n}\n"
}
'@
Write-File (Join-Path $root "challenges\java\L2_fib_memo.json") $javaL2

$javaL3 = @'
{
  "id": "java_l3_fib_perf",
  "title": "Fast Fibonacci modulo",
  "language": "java",
  "level": 3,
  "prompt": "Compute fib(n) modulo 1_000_000_007 efficiently for large n (e.g., 100000).",
  "starterCode": "public class Main {\n  static final long MOD = 1_000_000_007L;\n  static long fibMod(int n) {\n    // TODO\n    return 0;\n  }\n\n  public static void main(String[] args) {\n    System.out.println(fibMod(100000));\n  }\n}\n"
}
'@
Write-File (Join-Path $root "challenges\java\L3_fib_perf.json") $javaL3

Write-Host "Done."
Write-Host "Created: challenges/ (sql seed + starter challenges for all languages)"
Write-Host "Created: session_dbs/ (per-session sqlite databases will live here)"
