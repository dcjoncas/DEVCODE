function fib(n) {
  // BUG: base case returns 1 for both 0 and 1
  if (n <= 1) return 1;
  return fib(n - 1) + fib(n - 2);
}

console.log(fib(0)); // 0
console.log(fib(1)); // 1
console.log(fib(6)); // 8
