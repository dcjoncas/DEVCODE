using System;

class Program
{
    static void Main()
    {
        int firstnumber = 0, secondnumber = 1, result = 0;

        for (int i = 0; i < 10; i++)
        {
            if (i == 0)
            {
                result = firstnumber;
            }
            else if (i == 1)
            {
                result = secondnumber;
            }
            else
            {
                result = firstnumber + secondnumber;
                // Using tuple to swap variables
                (firstnumber, secondnumber) = (secondnumber, result);
            }

            Console.WriteLine(result);
        }
    }
}
