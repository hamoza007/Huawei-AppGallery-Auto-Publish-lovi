/*
 * appgallerycli — download APKs from Huawei AppGallery by C-code.
 *
 * Vendored from https://github.com/gnuvalerie/appgallerycli (MIT-style, see
 * upstream LICENSE). Built in the Docker image / deploy step with:
 *     gcc -o appgallerycli appgallerycli.c
 *
 * Usage: appgallerycli <C-id>   →   writes <C-id>.apk in the working directory.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <app_id>\n", argv[0]);
        return 1;
    }

    char cmd[512];
    snprintf(cmd, sizeof(cmd),
        "curl -fL -o '%s.apk' 'https://appgallery.cloud.huawei.com/appdl/%s'",
        argv[1], argv[1]);

    int ret = system(cmd);

    if (ret == 0) {
        printf("saved to %s.apk\n", argv[1]);
    } else {
        fprintf(stderr, "download failed\n");
        return 1;
    }

    return 0;
}
