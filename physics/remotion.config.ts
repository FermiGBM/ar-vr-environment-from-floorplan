import { Config } from '@remotion/cli/config';

Config.setEntryPoint('remotion/src/index.ts');
Config.setPublicDir('remotion/public');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setCodec('h264');
Config.setCrf(18);
