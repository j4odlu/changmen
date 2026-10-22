import {restoreLowOddsSingleSource,verifyLowOddsSingleSources} from "./low-odds-single-boundary.mjs";
// [changmen 扩展] 精确核对 9999 C 行增量，再还原原始迁移证明；不替换任何历史基线。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const normalize = source => source.replaceAll('\r\n', '\n');
const sha = source => createHash('sha256').update(normalize(source)).digest('hex');
const runtimeChanges = new Map([
  ['client/web/src/types/extensionPrefs.ts', {
    beforeSha: '7770b8e01802361382389cea2cf8a45608a5bd77235aae49b89d54080edb5323',
    afterSha: 'b32cfa1cc7976e0df2df5a80f79c72b72103e0c87b556b0a5e9d412e02724c02',
    additions: [
      '  /** [changmen 扩展] 9999 真下单腿仅允许当前盘口 C 行赛前概率较高的一方；无有效数据或同值时跳过。默认关闭。 */\n  singleLeg9999HigherCProbabilityOnly: boolean;\n',
      '    singleLeg9999HigherCProbabilityOnly: false,\n',
      '    singleLeg9999HigherCProbabilityOnly: row.singleLeg9999HigherCProbabilityOnly === true,\n',
    ],
  }],
  ['client/web/src/components/user/tabs/UserDiagExtensionsTab.vue', {
    beforeSha: '87e6b3d9e394028093a4167780d0dcd52a78b63aeb7d85aba52c61f018a3483c',
    afterSha: '173a28217610e51debc7cd8727f3e02308ad9ef77bda477b1e26ef33a4f89ce8',
    additions: [
      'extensionPrefs.value.singleLeg9999HigherCProbabilityOnly ??= false;\n',
      `        <el-form-item>
          <template #label>
            <el-tooltip
              placement="top"
              :show-after="200"
              popper-class="extensions-tab-tip"
              content="开：9999 真下单腿只允许当前盘口 C 行赛前概率较高的一方。C 行取 PM 登记开赛时间前历史价格；无有效数据或概率相同时跳过，不消耗同图次数。默认关闭。"
            >
              <span class="extensions-tab__tip-label">9999 仅下C行高胜率方</span>
            </el-tooltip>
          </template>
          <el-switch
            v-model="extensionPrefs.singleLeg9999HigherCProbabilityOnly"
            inline-prompt
            active-text="开"
            inactive-text="关"
          />
        </el-form-item>

`,
    ],
  }],
  ['client/web/src/stores/betting/autoBet/phases/prepareArbAttempt.ts', {
    beforeSha: '4336979e81d4939605be198a087f4f8cb94b3d06318d4165aefc6bedf6e0d247',
    afterSha: 'cf4cd90818da461dfb8a99382f0a790e6115e6d519d9aebfa724d0ffefe4bbf7',
    additions: [
      'import { explain9999CProbabilityRejection } from "@/extensions/arbBet/singleLeg9999CProbability";\n',
      `    // [changmen 扩展] 在同图次数占位和预检之前筛选，拒绝时不消耗次数。
    if (prefs.singleLeg9999HigherCProbabilityOnly === true) {
      const reason = explain9999CProbabilityRejection(bet, match, liveLeg?.target);
      if (reason) {
        trace?.finish("skip", reason);
        return null;
      }
    }
`,
    ],
  }],
]);

// 检查器自身也只准加入下面列出的调用；旧 workspace 证明仍对还原后的完整文件逐字核对。
const verificationChanges = new Map([
  [
    "scripts/verification/browser-entry-history.mjs",
    {
      "beforeSha": "d59a00101c681c4df39c5777e2b70d9d87c9f195a7727713e903cfb952834267",
      "afterSha": "0249678d0414fd6c1b3910057168abe3a5daec29510c95ee9ac9322077ce6b48",
      "edits": [
        [
          "import {restore9999CProbabilitySource} from './single-leg-9999-c-probability-boundary.mjs';\n",
          ""
        ],
        [
          " source=restoreRayA8PrecheckSource(relative(file),restore9999CProbabilitySource(relative(file),source));",
          " source=restoreRayA8PrecheckSource(relative(file),source);"
        ]
      ]
    }
  ],
  [
    "scripts/verification/browser-entry-retirement.mjs",
    {
      "beforeSha": "04203a93258ad7c52a83b4c5268c177f3dee5f5f0331f68e2877e4b5329df2d1",
      "afterSha": "df1b9a7aa659b7635f9380e5a27e7b1e6a647b55895ddc0fcca0210f93b9e8ef",
      "edits": [
        [
          "import {restore9999CProbabilitySource,verify9999CProbabilitySources} from './single-leg-9999-c-probability-boundary.mjs';\n",
          ""
        ],
        [
          "restoreRayA8PrecheckSource(row.file,restore9999CProbabilitySource(row.file,read(row.file)))",
          "restoreRayA8PrecheckSource(row.file,read(row.file))"
        ],
        [
          " verify9999CProbabilitySources(read);\n",
          ""
        ]
      ]
    }
  ],
  [
    "scripts/verification/workspace-layout-relocation.mjs",
    {
      "beforeSha": "c0fab6da293e1bf2edaf5c8af848e9fc8fb53ef14a7c38719bcd604c77440c3f",
      "afterSha": "88a961f9e97c3709223cc704addcb322c5445fc1ed38e9ccaa067495c1d1f6a6",
      "edits": [
        [
          "import {restore9999CProbabilityVerificationSource} from './single-leg-9999-c-probability-boundary.mjs';\n",
          ""
        ],
        [
          "restoreDeployCiSource(row.canonical,restore9999CProbabilityVerificationSource(row.canonical,read(row.canonical)))",
          "restoreDeployCiSource(row.canonical,read(row.canonical))"
        ]
      ]
    }
  ],
  [
    "scripts/verification/pm-unified-preflight-boundary.mjs",
    {
      "beforeSha": "887490f6f4c160a05ab87220d66d44831a72b7a4df9d6c056213752bad060cae",
      "afterSha": "958c1b800582516f293457b42820d212ad0c86e5e7a06501152896b2a6e55c71",
      "edits": [
        [
          "import { restore9999CProbabilitySource } from \"./single-leg-9999-c-probability-boundary.mjs\";\n",
          ""
        ],
        [
          "  source = restore9999CProbabilitySource(file, source);\n",
          ""
        ]
      ]
    }
  ]
]);

function restoreIncrement(changes, file, source) {
  const change = changes.get(file);
  if (!change || sha(source) !== change.afterSha) return source;
  source = normalize(source);
  for (const [after, before = ''] of change.edits ?? change.additions.map(after => [after])) {
    assert.equal(source.split(after).length, 2, `${file}: exact 9999 C probability increment must occur once`);
    source = source.replace(after, before);
  }
  assert.equal(sha(source), change.beforeSha, `${file}: complete original proof must restore`);
  return source;
}

export function restore9999CProbabilitySource(file, source) {
  return restoreIncrement(runtimeChanges, file, restoreLowOddsSingleSource(file, source));
}

export function restore9999CProbabilityVerificationSource(file, source) {
  return restoreIncrement(verificationChanges, file, restoreLowOddsSingleSource(file, source));
}

export function verify9999CProbabilitySources(read) {
  verifyLowOddsSingleSources();
  for (const [file, change] of runtimeChanges)
    assert.equal(sha(restoreLowOddsSingleSource(file, read(file))), change.afterSha, `${file}: only the exact 9999 C probability change is authorized`);
  const helper = 'client/web/src/extensions/arbBet/singleLeg9999CProbability.ts';
  assert.equal(sha(read(helper)), 'eecfd7f6eaf4825e76a20fce1f2e1abb3194bcbc0cad4b1af24263ddfa27681b', `${helper}: exact C probability filter implementation`);
  return {files: runtimeChanges.size + 1};
}
