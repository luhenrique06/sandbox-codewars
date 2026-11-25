#include <stdio.h>

int main() {
    int n, i, soma = 0;
    scanf("%d", &n);
    for (i = 1; i <= n; i++)
        if (i % 2 == 0)
            soma += i;
    printf("%d\n", soma);
    return 0;
}
