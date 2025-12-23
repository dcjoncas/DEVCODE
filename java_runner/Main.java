public class Main {
    // Compute the nth Fibonacci number (0-indexed).
    // TODO: Fix memoization so this runs fast for n up to 92.
    static long fib(int n) {
        long[] memo = new long[n + 1]; // BUG: re-created on every call; caching never works
        if (n <= 1) return n;
        if (memo[n] != 0) return memo[n];
        memo[n] = fib(n - 1) + fib(n - 2);
        return memo[n];
    }

    public static void main(String[] args) throws Exception {
        int n = 45; // large enough to be slow without proper memoization
        if (args.length > 0) n = Integer.parseInt(args[0]);
        System.out.println(fib(n));
    }
}
