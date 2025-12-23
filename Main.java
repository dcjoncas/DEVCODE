public class Main {

    // Memoized Fibonacci (like your Python version)
    static long fibonacci(int n, long[] memo) {
        if (n <= 1) return n;
        if (memo[n] != -1) return memo[n];

        memo[n] = fibonacci(n - 1, memo) + fibonacci(n - 2, memo);
        return memo[n];
    }

    public static void main(String[] args) {
        int max = 10;
        long[] memo = new long[max];
        for (int i = 0; i < max; i++) memo[i] = -1;

        for (int i = 0; i < max; i++) {
            System.out.println(fibonacci(i, memo));
        }
    }
}
