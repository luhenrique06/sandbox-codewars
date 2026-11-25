#include <stdio.h>

int main() {
    int n, i, x, maior, menor;
    scanf("%d", &n);
    scanf("%d", &x);
    maior = menor = x;
    for (i = 2; i <= n; i++) {
        scanf("%d", &x);
        if (x > maior) maior = x;
        if (x < menor) menor = x;
    }
    printf("%d %d\n", maior, menor);
    return 0;
}
