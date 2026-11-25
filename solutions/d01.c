#include <stdio.h>

int main() {
    float n1, n2, n3, media;
    scanf("%f %f %f", &n1, &n2, &n3);
    media = (n1 + n2 + n3) / 3;
    if (media >= 7.0)
        printf("%.1f Aprovado\n", media);
    else if (media >= 5.0)
        printf("%.1f Recuperação\n", media);
    else
        printf("%.1f Reprovado\n", media);
    return 0;
}
