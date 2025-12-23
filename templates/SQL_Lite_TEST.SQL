-- 1) First 10 customers (basic)
SELECT Id, Name, City, State, Industry
FROM Customers
LIMIT 10;

-- 2) Active customers only
SELECT Id, Name, Email, City, State
FROM Customers
WHERE IsActive = 1
ORDER BY Name;

-- 3) Customers in a specific state
SELECT Id, Name, City, State
FROM Customers
WHERE State = 'CO'
ORDER BY City, Name;

-- 4) Recently created customers: CreatedAt
SELECT Id, Name, CreatedDate
FROM Customers
ORDER BY CreatedDate DESC
LIMIT 10;

-- 5) Search by name keyword
SELECT Id, Name, Industry
FROM Customers
WHERE Name LIKE '%Energy%'
ORDER BY Name;


-- 6) Count customers by State
SELECT State, COUNT(*) AS CustomerCount
FROM Customers
GROUP BY State
ORDER BY CustomerCount DESC, State;

-- 7) Count customers by Industry (active only)
SELECT Industry, COUNT(*) AS ActiveCustomerCount
FROM Customers
WHERE IsActive = 1
GROUP BY Industry
ORDER BY ActiveCustomerCount DESC;

-- 8) Customers by City + State (top 10)
SELECT City, State, COUNT(*) AS CustomerCount
FROM Customers
GROUP BY City, State
ORDER BY CustomerCount DESC, City, State
LIMIT 10;

-- 9) New customers by year (CreatedDate is 'YYYY-MM-DD')
SELECT substr(CreatedDate, 1, 4) AS Year, COUNT(*) AS CustomersCreated
FROM Customers
GROUP BY Year
ORDER BY Year;

-- 10) Active vs inactive split
SELECT IsActive, COUNT(*) AS CountCustomers
FROM Customers
GROUP BY IsActive
ORDER BY IsActive DESC;

-- Tricky 1: States with >= 2 customers (HAVING)
SELECT State, COUNT(*) AS CustomerCount
FROM Customers
GROUP BY State
HAVING COUNT(*) >= 2
ORDER BY CustomerCount DESC;

-- Tricky 2: Top Industry per State (window function; SQLite supports this)
WITH x AS (
  SELECT State, Industry, COUNT(*) AS cnt,
         ROW_NUMBER() OVER (PARTITION BY State ORDER BY COUNT(*) DESC) AS rn
  FROM Customers
  GROUP BY State, Industry
)
SELECT State, Industry, cnt
FROM x
WHERE rn = 1
ORDER BY State;

