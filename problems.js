// Desafios da prova. `examples` aparecem para o aluno; `tests` ficam só no servidor.
// O envio roda examples + tests. Saídas comparadas por tokens, sem acentos.

const tabuada = (n) =>
  Array.from({ length: 10 }, (_, i) => `${n} x ${i + 1} = ${n * (i + 1)}`).join('\n');

const somaPares = (n) => {
  let s = 0;
  for (let i = 2; i <= n; i += 2) s += i;
  return s;
};

const fatorial = (n) => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

const ehPrimo = (n) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};

const problems = [
  {
    id: 'd01',
    title: 'Situação do Aluno',
    statement: `
<p>Escreva um programa em C que leia as notas de três avaliações de um aluno, calcule a média aritmética entre elas e informe a situação do aluno de acordo com a média:</p>
<ul>
  <li>média maior ou igual a 7,0 &rarr; <code>Aprovado</code></li>
  <li>média maior ou igual a 5,0 e menor que 7,0 &rarr; <code>Recuperação</code></li>
  <li>média menor que 5,0 &rarr; <code>Reprovado</code></li>
</ul>
<p><b>Entrada:</b> três valores reais, representando as notas das três avaliações do aluno.</p>
<p><b>Saída:</b> o valor da média <b>com uma casa decimal</b>, seguido da situação do aluno.</p>`,
    examples: [
      { input: '8.0 9.0 7.5\n', output: '8.2 Aprovado' },
      { input: '6.0 5.0 6.0\n', output: '5.7 Recuperação' },
      { input: '3.0 4.0 2.0\n', output: '3.0 Reprovado' },
    ],
    tests: [
      { input: '7.0 7.0 7.0\n', output: '7.0 Aprovado' },
      { input: '5.0 5.0 5.0\n', output: '5.0 Recuperação' },
      { input: '4.5 5.0 5.5\n', output: '5.0 Recuperação' },
      { input: '10.0 10.0 10.0\n', output: '10.0 Aprovado' },
      { input: '0.0 0.0 0.0\n', output: '0.0 Reprovado' },
      { input: '9.5 6.0 4.0\n', output: '6.5 Recuperação' },
      { input: '4.0 4.5 5.0\n', output: '4.5 Reprovado' },
    ],
  },
  {
    id: 'd02',
    title: 'Sequência de Fibonacci',
    statement: `
<p>A sequência de Fibonacci é definida por F(1) = 0, F(2) = 1 e F(n) = F(n-1) + F(n-2) para n maior ou igual a 3.</p>
<p>Escreva um programa em C que, <b>usando um laço de repetição</b>, imprima os 10 primeiros termos dessa sequência.</p>
<p><b>Entrada:</b> este desafio não possui entrada.</p>
<p><b>Saída:</b> os 10 primeiros termos da sequência de Fibonacci, em uma única linha, separados por espaço.</p>`,
    examples: [{ input: '', output: '0 1 1 2 3 5 8 13 21 34' }],
    tests: [],
  },
  {
    id: 'd03',
    title: 'Par ou Ímpar',
    statement: `
<p>Escreva um programa em C que leia um número inteiro e informe se ele é par ou ímpar.</p>
<p><b>Entrada:</b> um único valor inteiro n.</p>
<p><b>Saída:</b> a palavra <code>Par</code>, se n for divisível por 2, ou a palavra <code>Ímpar</code>, caso contrário.</p>`,
    examples: [
      { input: '10\n', output: 'Par' },
      { input: '7\n', output: 'Ímpar' },
    ],
    tests: [
      { input: '0\n', output: 'Par' },
      { input: '1\n', output: 'Ímpar' },
      { input: '2\n', output: 'Par' },
      { input: '999\n', output: 'Ímpar' },
      { input: '1000000\n', output: 'Par' },
      { input: '-4\n', output: 'Par' },
    ],
  },
  {
    id: 'd04',
    title: 'Soma dos Números Pares',
    statement: `
<p>Escreva um programa em C que leia um número inteiro positivo N e calcule a soma de todos os números pares entre 1 e N, incluindo o próprio N caso ele seja par.</p>
<p><b>Entrada:</b> um único valor inteiro N, com N &ge; 1.</p>
<p><b>Saída:</b> um único valor inteiro com a soma dos números pares no intervalo de 1 até N.</p>`,
    examples: [
      { input: '10\n', output: '30' },
      { input: '7\n', output: '12' },
    ],
    tests: [1, 2, 3, 100, 1000, 999].map((n) => ({ input: `${n}\n`, output: String(somaPares(n)) })),
  },
  {
    id: 'd05',
    title: 'Tabuada',
    statement: `
<p>Escreva um programa em C que leia um número inteiro n e imprima sua tabuada de multiplicação, de 1 a 10, uma linha para cada multiplicação, no formato exato <code>n x i = resultado</code>, sendo i o multiplicador de 1 a 10 e resultado igual a n vezes i.</p>
<p><b>Entrada:</b> um único valor inteiro n.</p>
<p><b>Saída:</b> dez linhas, cada uma no formato <code>n x i = resultado</code>, para i variando de 1 a 10.</p>`,
    examples: [{ input: '3\n', output: tabuada(3) }],
    tests: [7, 1, 0, 9, 10, 25].map((n) => ({ input: `${n}\n`, output: tabuada(n) })),
  },
  {
    id: 'd06',
    title: 'Ano Bissexto',
    statement: `
<p>Escreva um programa em C que leia um ano e informe se ele é bissexto.</p>
<p>Um ano é bissexto se for divisível por 4 e <b>não</b> for divisível por 100, <b>ou</b> se for divisível por 400.</p>
<p><b>Entrada:</b> um único valor inteiro, o ano (maior que 0).</p>
<p><b>Saída:</b> <code>Bissexto</code> ou <code>Não bissexto</code>.</p>`,
    examples: [
      { input: '2024\n', output: 'Bissexto' },
      { input: '1900\n', output: 'Não bissexto' },
    ],
    tests: [
      { input: '2000\n', output: 'Bissexto' },
      { input: '2023\n', output: 'Não bissexto' },
      { input: '2100\n', output: 'Não bissexto' },
      { input: '2400\n', output: 'Bissexto' },
      { input: '1996\n', output: 'Bissexto' },
      { input: '2025\n', output: 'Não bissexto' },
    ],
  },
  {
    id: 'd07',
    title: 'Fatorial',
    statement: `
<p>Escreva um programa em C que leia um número inteiro N e, <b>usando um laço de repetição</b>, calcule e imprima o fatorial de N.</p>
<p>Lembre-se: N! = 1 &times; 2 &times; ... &times; N, e 0! = 1.</p>
<p><b>Entrada:</b> um único valor inteiro N, com 0 &le; N &le; 12.</p>
<p><b>Saída:</b> um único valor inteiro, o fatorial de N.</p>`,
    examples: [
      { input: '5\n', output: '120' },
      { input: '0\n', output: '1' },
    ],
    tests: [1, 3, 6, 10, 12].map((n) => ({ input: `${n}\n`, output: String(fatorial(n)) })),
  },
  {
    id: 'd08',
    title: 'Número Primo',
    statement: `
<p>Escreva um programa em C que leia um número inteiro N e informe se ele é primo.</p>
<p>Um número é primo se for maior que 1 e divisível apenas por 1 e por ele mesmo.</p>
<p><b>Entrada:</b> um único valor inteiro N, com N &ge; 1.</p>
<p><b>Saída:</b> <code>Primo</code> ou <code>Não primo</code>.</p>`,
    examples: [
      { input: '7\n', output: 'Primo' },
      { input: '1\n', output: 'Não primo' },
    ],
    tests: [2, 3, 4, 9, 17, 97, 100, 7919].map((n) => ({
      input: `${n}\n`,
      output: ehPrimo(n) ? 'Primo' : 'Não primo',
    })),
  },
  {
    id: 'd09',
    title: 'Soma dos Dígitos',
    statement: `
<p>Escreva um programa em C que leia um número inteiro positivo N e imprima a soma dos seus dígitos.</p>
<p>Dica: <code>N % 10</code> fornece o último dígito e <code>N / 10</code> remove o último dígito.</p>
<p><b>Entrada:</b> um único valor inteiro N, com 1 &le; N &le; 1000000000.</p>
<p><b>Saída:</b> um único valor inteiro, a soma dos dígitos de N.</p>`,
    examples: [
      { input: '1234\n', output: '10' },
      { input: '5\n', output: '5' },
    ],
    tests: [
      { input: '1000\n', output: '1' },
      { input: '99999\n', output: '45' },
      { input: '907\n', output: '16' },
      { input: '10\n', output: '1' },
      { input: '1000000000\n', output: '1' },
    ],
  },
  {
    id: 'd10',
    title: 'Maior e Menor',
    statement: `
<p>Escreva um programa em C que leia um número inteiro N e, em seguida, N números inteiros. O programa deve imprimir o maior e o menor valor lidos.</p>
<p><b>Entrada:</b> a primeira linha contém N (N &ge; 1). A segunda linha contém N valores inteiros separados por espaço.</p>
<p><b>Saída:</b> o maior e o menor valor, nessa ordem, separados por espaço.</p>`,
    examples: [
      { input: '5\n3 9 -2 7 4\n', output: '9 -2' },
      { input: '1\n42\n', output: '42 42' },
    ],
    tests: [
      { input: '3\n-5 -1 -9\n', output: '-1 -9' },
      { input: '4\n0 0 0 0\n', output: '0 0' },
      { input: '6\n100 50 200 150 -100 0\n', output: '200 -100' },
      { input: '2\n7 3\n', output: '7 3' },
      { input: '5\n1 2 3 4 5\n', output: '5 1' },
      { input: '5\n5 4 3 2 1\n', output: '5 1' },
    ],
  },
];

const byId = Object.fromEntries(problems.map((p) => [p.id, p]));

// Versão enviada ao aluno: sem testes ocultos.
const publicProblems = () =>
  problems.map(({ id, title, statement, examples }) => ({ id, title, statement, examples }));

module.exports = { problems, byId, publicProblems };
