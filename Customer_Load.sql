-- =========================================
-- Drop existing tables (if they exist)
-- =========================================
DROP TABLE IF EXISTS Invoices;
DROP TABLE IF EXISTS Projects;
DROP TABLE IF EXISTS Customers;

-- =========================================
-- Customers: Basic customer master data
-- =========================================
CREATE TABLE Customers (
  Id              INTEGER PRIMARY KEY,
  Name            TEXT NOT NULL,
  Email           TEXT,
  City            TEXT,
  State           TEXT,
  Country         TEXT,
  Industry        TEXT,
  IsActive        INTEGER NOT NULL DEFAULT 1, -- 1 = active, 0 = inactive
  CreatedAt       TEXT NOT NULL               -- ISO date string
);

-- =========================================
-- Projects: One customer can have many projects
-- =========================================
CREATE TABLE Projects (
  Id              INTEGER PRIMARY KEY,
  CustomerId      INTEGER NOT NULL,
  Name            TEXT NOT NULL,
  Status          TEXT NOT NULL,              -- e.g. 'Active', 'On Hold', 'Completed'
  StartDate       TEXT,
  EndDate         TEXT,
  Budget          REAL,                       -- simple numeric budget
  FOREIGN KEY (CustomerId) REFERENCES Customers(Id)
);

-- =========================================
-- Invoices: Linked to customers and optionally projects
-- =========================================
CREATE TABLE Invoices (
  Id              INTEGER PRIMARY KEY,
  CustomerId      INTEGER NOT NULL,
  ProjectId       INTEGER,
  InvoiceDate     TEXT NOT NULL,
  Amount          REAL NOT NULL,
  IsPaid          INTEGER NOT NULL DEFAULT 0, -- 0 = unpaid, 1 = paid
  FOREIGN KEY (CustomerId) REFERENCES Customers(Id),
  FOREIGN KEY (ProjectId) REFERENCES Projects(Id)
);

-- =========================================
-- Seed data: Customers
-- =========================================
INSERT INTO Customers (Id, Name, Email, City, State, Country, Industry, IsActive, CreatedAt) VALUES
  (1, 'Acme Manufacturing',         'ops@acme-mfg.com',      'Denver',       'CO', 'USA', 'Manufacturing', 1, '2023-01-15'),
  (2, 'Northwind Logistics',        'it@northwind-log.com',  'Seattle',      'WA', 'USA', 'Logistics',     1, '2023-03-02'),
  (3, 'Global Retail Group',        'tech@gr-retail.com',    'Chicago',      'IL', 'USA', 'Retail',        1, '2022-11-20'),
  (4, 'Pioneer Energy Services',    'info@pioneer-energy.io','Houston',      'TX', 'USA', 'Energy',        1, '2022-09-05'),
  (5, 'Summit Financial Partners',  'admin@summit-fin.com',  'New York',     'NY', 'USA', 'Financial',     1, '2023-05-10'),
  (6, 'BlueSky Health Systems',     'it@bluesky-health.com', 'San Diego',    'CA', 'USA', 'Healthcare',    1, '2023-02-28'),
  (7, 'Vertex Construction Group',  'pm@vertex-build.com',   'Phoenix',      'AZ', 'USA', 'Construction',  0, '2021-07-14'),
  (8, 'Aurora Tech Solutions',      'dev@aurora-tech.io',    'Austin',       'TX', 'USA', 'Technology',    1, '2023-08-01');

-- =========================================
-- Seed data: Projects
-- =========================================
INSERT INTO Projects (Id, CustomerId, Name, Status, StartDate, EndDate, Budget) VALUES
  (1, 1, 'Plant Maintenance Portal',        'Active',    '2023-04-01', NULL,         250000.00),
  (2, 1, 'Inventory Optimization Pilot',    'Completed', '2023-01-01', '2023-03-15',  90000.00),
  (3, 2, 'Fleet Tracking Dashboard',        'Active',    '2023-06-10', NULL,         180000.00),
  (4, 3, 'E-Commerce Revamp',               'On Hold',   '2022-10-05', NULL,         320000.00),
  (5, 5, 'Risk Analytics Platform',         'Active',    '2023-02-01', NULL,         450000.00),
  (6, 8, 'Customer Data Hub',               'Completed', '2023-03-15', '2023-09-01', 210000.00);

-- =========================================
-- Seed data: Invoices
-- =========================================
INSERT INTO Invoices (Id, CustomerId, ProjectId, InvoiceDate, Amount, IsPaid) VALUES
  (1, 1, 1, '2023-04-15',  50000.00, 1),
  (2, 1, 1, '2023-05-15',  75000.00, 0),
  (3, 1, 2, '2023-03-20',  90000.00, 1),
  (4, 2, 3, '2023-07-01',  60000.00, 0),
  (5, 3, 4, '2022-12-01', 120000.00, 1),
  (6, 5, 5, '2023-03-01', 150000.00, 0),
  (7, 8, 6, '2023-05-01', 100000.00, 1),
  (8, 8, 6, '2023-08-10', 110000.00, 0);
