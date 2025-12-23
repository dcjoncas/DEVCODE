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
