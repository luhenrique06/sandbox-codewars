// Valida juiz + testes: gabaritos devem passar, soluções erradas e ataques devem falhar.
// Uso: node scripts/verify.js
const fs = require('fs');
const path = require('path');
const judge = require('../judge');
const { problems, byId } = require('../problems');

const allCases = (p) => [...p.examples, ...p.tests];
let failures = 0;

function check(label, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}

// Soluções que devem ser rejeitadas: [desafio, descrição, código, veredito esperado]
const wrong = [
  ['d01', 'média truncada (5.6)', `#include <stdio.h>
int main(){float a,b,c;scanf("%f %f %f",&a,&b,&c);float m=(a+b+c)/3;m=(int)(m*10)/10.0;
if(m>=7)printf("%.1f Aprovado",m);else if(m>=5)printf("%.1f Recuperação",m);else printf("%.1f Reprovado",m);}`, 'Resposta errada'],
  ['d01', 'imprime "Digite as notas"', `#include <stdio.h>
int main(){float a,b,c;printf("Digite as notas: ");scanf("%f %f %f",&a,&b,&c);float m=(a+b+c)/3;
if(m>=7)printf("%.1f Aprovado",m);else if(m>=5)printf("%.1f Recuperação",m);else printf("%.1f Reprovado",m);}`, 'Resposta errada'],
  ['d03', 'troca Par/Ímpar', `#include <stdio.h>
int main(){int n;scanf("%d",&n);printf(n%2?"Par":"Ímpar");}`, 'Resposta errada'],
  ['d07', 'esquece 0! = 1 (começa com 0)', `#include <stdio.h>
int main(){int n,i,f=0;scanf("%d",&n);for(i=1;i<=n;i++)f=f?f*i:i;printf("%d",f);}`, 'Resposta errada'],
  ['d08', 'diz que 1 é primo', `#include <stdio.h>
int main(){int n,i,p=1;scanf("%d",&n);for(i=2;i<n;i++)if(n%i==0)p=0;printf(p?"Primo":"Não primo");}`, 'Resposta errada'],
  ['d10', 'maior começa em 0 (falha com negativos)', `#include <stdio.h>
int main(){int n,i,x,M=0,m=1000000;scanf("%d",&n);for(i=0;i<n;i++){scanf("%d",&x);if(x>M)M=x;if(x<m)m=x;}printf("%d %d",M,m);}`, 'Resposta errada'],
  ['d04', 'erro de sintaxe', `#include <stdio.h>
int main(){ int n scanf("%d",&n); }`, 'Erro de compilação'],
  ['d04', 'laço infinito', `int main(){ while(1); }`, 'Tempo excedido'],
  ['d04', 'segfault', `#include <stdio.h>
int main(){ int *p = 0; *p = 1; printf("0"); }`, 'Erro de execução'],
];

// Hábitos Dev-C++ que devem compilar e passar.
const devcpp = `#include <stdio.h>
#include <stdlib.h>
#include <conio.h>
#include <locale.h>
#include <windows.h>
void main(){
  int n;
  setlocale(LC_ALL, "Portuguese");
  SetConsoleOutputCP(CP_UTF8);
  fflush(stdin);
  scanf("%d", &n);
  if (n % 2 == 0) printf("Par\\n"); else printf("Impar\\n");
  system("pause");
  getch();
}`;

async function main() {
  console.log('== gabaritos ==');
  for (const p of problems) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'solutions', `${p.id}.c`), 'utf8');
    const r = await judge.submit(code, allCases(p));
    check(`${p.id} ${p.title} (${allCases(p).length} casos)`, r.verdict === 'Aceito', JSON.stringify(r));
  }

  console.log('\n== soluções erradas ==');
  for (const [id, desc, code, expected] of wrong) {
    const r = await judge.submit(code, allCases(byId[id]));
    check(`${id} ${desc} → ${expected}`, r.verdict === expected, `obtido: ${r.verdict}`);
  }

  console.log('\n== hábitos Dev-C++ ==');
  const r = await judge.submit(devcpp, allCases(byId.d03));
  check('conio.h + windows.h + void main + system("pause") + sem acento', r.verdict === 'Aceito', JSON.stringify(r));

  console.log('\n== sandbox ==');
  const attacks = [
    ['sem rede', `#include <stdlib.h>
int main(){ return system("getent hosts google.com > /dev/null 2>&1 && echo REDE || echo SEMREDE"); }`, (o) => o.includes('SEMREDE')],
    ['não vê arquivos do servidor', `#include <stdio.h>
int main(){ FILE *f = fopen("${path.join(__dirname, '..', 'problems.js')}", "r"); printf(f ? "VAZOU" : "PROTEGIDO"); }`, (o) => o.includes('PROTEGIDO')],
    ['fork bomb contida', `#include <unistd.h>
#include <stdio.h>
int main(){ for(int i=0;i<10000;i++) fork(); printf("FIM"); }`, (o, s) => s !== 'Erro no juiz'],
    ['saída infinita cortada', `#include <stdio.h>
int main(){ for(;;) printf("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"); }`, (o, s) => s === 'Tempo excedido' && o.length <= 10000],
    ['root fs somente leitura', `#include <stdio.h>
int main(){ FILE *f = fopen("/etc/hack", "w"); printf(f ? "ESCREVEU" : "BLOQUEADO"); }`, (o) => o.includes('BLOQUEADO')],
  ];
  for (const [label, code, ok] of attacks) {
    const t0 = Date.now();
    const res = await judge.run(code, '');
    check(label, ok(res.stdout || '', res.status), `${res.status} ${(res.stdout || '').slice(0, 40)} (${Date.now() - t0} ms)`);
  }

  console.log('\n== carga: 40 envios simultâneos ==');
  const code = fs.readFileSync(path.join(__dirname, '..', 'solutions', 'd05.c'), 'utf8');
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: 40 }, () => judge.submit(code, allCases(byId.d05))),
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check(`40 envios em ${secs}s`, results.every((x) => x.verdict === 'Aceito'));

  console.log(failures ? `\n${failures} FALHA(S)` : '\nTudo OK');
  process.exit(failures ? 1 : 0);
}

main();
