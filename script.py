def fib(n: int, memo=None) -> int:
    if memo is None:
        memo = {}

    if n in memo:
        return memo[n]

    if n <= 1:
        return n

    memo[n] = fib(n - 1, memo) + fib(n - 2, memo)
    return memo[n]

if __name__ == "__main__":
    print(fib(10))   # 55
    print(fib(35))   # 9227465
