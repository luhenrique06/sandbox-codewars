#include <stdio.h>

int main() {
    int n, i, divisores = 0;
    scanf("%d", &n);
    for (i = 1; i <= n; i++)
        if (n % i == 0)
            divisores++;
    if (divisores == 2)
        printf("Primo\n");
    else
        printf("Não primo\n");
    return 0;
}
