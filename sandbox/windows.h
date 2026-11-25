/* Stub de windows.h para o juiz em Linux: cobre o que alunos usam para acentuação e pausa. */
#ifndef PROVA_WINDOWS_H
#define PROVA_WINDOWS_H
#define CP_UTF8 65001
static inline int SetConsoleOutputCP(unsigned int cp) { (void)cp; return 1; }
static inline int SetConsoleCP(unsigned int cp) { (void)cp; return 1; }
static inline void Sleep(unsigned long ms) { (void)ms; }
#endif
