#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

static int decimal(const char *value, unsigned long *out) {
  char *end = NULL;
  errno = 0;
  unsigned long parsed = strtoul(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0') return 0;
  *out = parsed;
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 6 || strcmp(argv[1], "verify") != 0 || strcmp(argv[2], "--fd") != 0 ||
      strcmp(argv[4], "--expected-uid") != 0) return 64;
  unsigned long fd_value = 0, expected = 0;
  if (!decimal(argv[3], &fd_value) || fd_value != 3 || !decimal(argv[5], &expected)) return 64;
  uid_t peer_uid;
#if defined(__linux__)
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  if (getsockopt(3, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0 ||
      length != sizeof(credentials)) return 77;
  peer_uid = credentials.uid;
#elif defined(__APPLE__)
  gid_t peer_gid;
  if (getpeereid(3, &peer_uid, &peer_gid) != 0) return 77;
#else
  return 78;
#endif
  if ((unsigned long)peer_uid != expected) return 77;
  if (printf("{\"verified\":true,\"uid\":%lu}\n", expected) < 0) return 74;
  return 0;
}
