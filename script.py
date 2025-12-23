

def fib(n: int) -> int:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

if __name__ == "__main__":
    print(fib(0))  # 0
    print(fib(1))  # 1
    print(fib(6))  # 8

