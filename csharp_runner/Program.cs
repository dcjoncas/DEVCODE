using System;

class Program
{
    static void Main()
    {
        // Input: two space-separated numbers: n m
        var parts = (Console.ReadLine() ?? "").Split(new[]{' ','\t'}, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2)
        {
            Console.WriteLine("0");
            return;
        }
        if (!long.TryParse(parts[0], out long n) || !long.TryParse(parts[1], out long mod))
        {
            Console.WriteLine("0");
            return;
        }
        Console.WriteLine(FibNaive(n, mod));
    }

    // TODO: This naive recursion is too slow for large n.
    // Fix the bug and refactor to a fast O(log n) method (fast doubling or equivalent).
    static long FibNaive(long n, long mod)
    {
        if (n <= 1) return n % m; // BUG: 'm' does not exist. Use parameter and refactor algorithm.
        return (FibNaive(n - 1, mod) + FibNaive(n - 2, mod)) % mod;
    }
}
