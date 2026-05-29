# 🏎️ Forza Horizon 6 - Documentação "Data Out"

- **Autor:** Avatar Forza Support Team
- **Última Atualização:** Há 13 dias
- **Categoria:** Suporte Técnico / Telemetria

O Forza Horizon 6 mantém a tecnologia de telemetria herdada de títulos anteriores da franquia para alimentar simuladores de movimento (_motion sleds_), aplicativos acompanhantes (_companion apps_), dashboards externos e muito mais. Chamamos essa funcionalidade de **"Data Out"**.

---

## 📋 Visão Geral

Após ser ativado e configurado no menu do jogo, o recurso passa a transmitir pacotes de dados de telemetria em tempo real para aplicativos externos.

- **Protocolo:** Tráfego UDP unidirecional (apenas envio).
- **Frequência:** A taxa de envio é igual à taxa de quadros (_frame rate_) atual do jogo.
- **Destino:** Pode ser enviado para um IP remoto na rede ou para o endereço local (_localhost_ / `127.0.0.1`).
- **Conteúdo:** Um único formato de pacote fixo contendo a dinâmica do veículo, dados dos pneus, status da corrida e comandos do jogador.

---

## ⚙️ Configuração In-Game

As configurações podem ser ajustadas no menu do jogo em:

`CONFIGURAÇÕES (SETTINGS) > HUD E JOGABILIDADE (HUD AND GAMEPLAY)`

| Configuração            | Descrição                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data Out**            | Ativa ou desativa a função. Quando definido como **On (Ligado)**, os dados começam a ser transmitidos assim que o jogador começa a dirigir.                      |
| **Data Out IP Address** | O endereço IP da máquina remota que receberá os dados. O endereço local (`127.0.0.1`) é suportado.                                                               |
| **Data Out IP Port**    | A porta de rede UDP de destino. Garanta que o seu aplicativo esteja escutando na mesma porta e que as regras de firewall permitam o recebimento do tráfego. <br> |

<br>⚠️ _Evite as portas entre **5200 e 5300**, pois o jogo reserva essa faixa para seus próprios sockets de saída._ |

---

## 📐 Estrutura de Tipos de Dados

Os tipos de dados são representados pela convenção `[Letra][Número]`:

- **S (Signed):** Inteiro com sinal.
- **U (Unsigned):** Inteiro sem sinal (apenas valores positivos).
- **F (Floating Point):** Número de ponto flutuante (decimal).
- **Número:** Define a quantidade de _bits_ ocupados na memória.

**Exemplos:**

- `S8`: Byte com sinal (valores de -128 a 127).
- `U32`: Inteiro de 32 bits sem sinal.
- `F32`: Ponto flutuante de 32 bits (equivalente a _float_ ou _single_).

---

## 📦 Formato do Pacote (Packet Format)

- **Tamanho total do pacote:** 324 bytes (Fixo).

Abaixo está a estrutura exata do pacote, listada na ordem sequencial em que os dados são transmitidos:

### 1. Status Geral e Tempo

```cpp
S32 IsRaceOn;       // = 1 quando a corrida está ativa; = 0 em menus ou corrida parada.
U32 TimestampMS;    // Registro de tempo em milissegundos (pode resetar/transbordar para 0 eventualmente).

```

### 2. Motor e Propulsão

```cpp
F32 EngineMaxRpm;      // Rotação máxima do motor (RPM)
F32 EngineIdleRpm;     // Rotação de marcha lenta do motor (RPM)
F32 CurrentEngineRpm;  // Rotação atual do motor (RPM)
F32 Boost;             // Pressão do turbo/supercharger (PSI acima da pressão atmosférica)
F32 Fuel;              // Nível de combustível (0.0 = vazio, 1.0 = cheio)

```

### 3. Dinâmica do Veículo (Espaço Local do Carro)

_Para as coordenadas locais do carro: `X = Direita`, `Y = Cima`, `Z = Frente`._

```cpp
// Aceleração nos eixos X, Y, Z
F32 AccelerationX;
F32 AccelerationY;
F32 AccelerationZ;

// Velocidade nos eixos X, Y, Z
F32 VelocityX;
F32 VelocityY;
F32 VelocityZ;

// Velocidade angular (radianos por segundo)
F32 AngularVelocityX; // Pitch (Arfagem)
F32 AngularVelocityY; // Yaw (Guinada)
F32 AngularVelocityZ; // Roll (Rolagem)

// Orientação do carro (em radianos)
F32 Yaw;
F32 Pitch;
F32 Roll;

```

### 4. Suspensão (Por Roda)

```cpp
// Curso da suspensão normalizado: 0.0f = extensão máxima; 1.0f = compressão máxima
F32 NormalizedSuspensionTravelFrontLeft;
F32 NormalizedSuspensionTravelFrontRight;
F32 NormalizedSuspensionTravelRearLeft;
F32 NormalizedSuspensionTravelRearRight;

// Curso real da suspensão em metros
F32 SuspensionTravelMetersFrontLeft;
F32 SuspensionTravelMetersFrontRight;
F32 SuspensionTravelMetersRearLeft;
F32 SuspensionTravelMetersRearRight;

```

### 5. Dados dos Pneus e Superfície (Por Roda)

```cpp
// Razão de deslizamento (Slip Ratio): 0 = 100% de aderência; |razão| > 1.0 = perda de aderência
F32 TireSlipRatioFrontLeft;
F32 TireSlipRatioFrontRight;
F32 TireSlipRatioRearLeft;
F32 TireSlipRatioRearRight;

// Velocidade de rotação da roda em radianos por segundo
F32 WheelRotationSpeedFrontLeft;
F32 WheelRotationSpeedFrontRight;
F32 WheelRotationSpeedRearLeft;
F32 WheelRotationSpeedRearRight;

// Presença em Zebra: = 1 quando a roda está na zebra; = 0 quando fora
S32 WheelOnRumbleStripFrontLeft;
S32 WheelOnRumbleStripFrontRight;
S32 WheelOnRumbleStripRearLeft;
S32 WheelOnRumbleStripRearRight;

// Presença em Poça d'água: = 1 quando a roda está em uma poça; = 0 quando não
S32 WheelInPuddleFrontLeft;
S32 WheelInPuddleFrontRight;
S32 WheelInPuddleRearLeft;
S32 WheelInPuddleRearRight;

// Valores adimensionais de vibração da superfície (enviados para o Force Feedback do controle)
F32 SurfaceRumbleFrontLeft;
F32 SurfaceRumbleFrontRight;
F32 SurfaceRumbleRearLeft;
F32 SurfaceRumbleRearRight;

// Ângulo de deslizamento (Slip Angle): 0 = 100% de aderência; |ângulo| > 1.0 = perda de aderência
F32 TireSlipAngleFrontLeft;
F32 TireSlipAngleFrontRight;
F32 TireSlipAngleRearLeft;
F32 TireSlipAngleRearRight;

// Deslizamento combinado normalizado: 0 = 100% de aderência; |slip| > 1.0 = perda de aderência
F32 TireCombinedSlipFrontLeft;
F32 TireCombinedSlipFrontRight;
F32 TireCombinedSlipRearLeft;
F32 TireCombinedSlipRearRight;

// Temperatura dos pneus
F32 TireTempFrontLeft;
F32 TireTempFrontRight;
F32 TireTempRearLeft;
F32 TireTempRearRight;

```

### 6. Informações do Carro e Perfil

```cpp
S32 CarOrdinal;           // ID único do modelo/fabricante do carro
S32 CarClass;             // Classe do carro: entre 0 (Classe D - pior) e 7 (Classe X - melhor)
S32 CarPerformanceIndex;  // Índice de Desempenho (PI): entre 100 e 999 inclusive
S32 DrivetrainType;       // Tipo de transmissão: 0 = FWD (Tração Dianteira), 1 = RWD (Traseira), 2 = AWD (Integral)
S32 NumCylinders;         // Número de cilindros no motor

// --- Campos exclusivos do Forza Horizon 6 ---
U32 CarGroup;             // Identificador do grupo do carro
F32 SmashableVelDiff;     // Perda de velocidade ao colidir com objetos destrutíveis (m/s)
F32 SmashableMass;        // Massa do objeto destrutível recém-atingido (kg)

```

### 7. Posicionamento e Desempenho Global

```cpp
// Posição no espaço do mundo (em metros)
F32 PositionX;
F32 PositionY;
F32 PositionZ;

F32 Speed;             // Velocidade em metros por segundo (m/s)
F32 Power;             // Potência atual em Watts (W)
F32 Torque;            // Torque atual em Newton-metros (Nm)
F32 DistanceTraveled;  // Distância total percorrida (em metros)

```

### 8. Tempos e Progresso da Corrida

```cpp
// Tempos de volta (em segundos); 0.0 se não aplicável
F32 BestLap;           // Melhor volta
F32 LastLap;           // Última volta
F32 CurrentLap;        // Volta atual

F32 CurrentRaceTime;   // Tempo total de corrida (em segundos desde o início da condução)
U16 LapNumber;         // Número de voltas completadas
RacePosition;      // Posição atual na corrida

```

### 9. Inputs (Comandos) do Jogador

```cpp
// Inputs de Pedais/Controles (Escala de 0 a 255)
U8 Accel;              // Acelerador
U8 Brake;              // Freio
U8 Clutch;             // Embreagem
U8 HandBrake;          // Freio de mão

U8 Gear;               // Marcha atual

// Esterço: -127 = Totalmente para a esquerda, 0 = Centro, 127 = Totalmente para a direita
S8 Steer;

S8 NormalizedDrivingLine;         // Posição normalizada da linha de condução (-127 a 127)
S8 NormalizedAIBrakeDifference;   // Diferença normalizada de frenagem da IA (-127 a 127)

```

---

## 📝 Notas Importantes para Desenvolvedores

1. **Gatilho de Envio:** O jogo envia dados **apenas** enquanto o jogador está controlando ativamente o carro em movimento. A transmissão é interrompida em menus, telas de pausa, replays, efeitos de retrocesso (_rewind_) ou após cruzar a linha de chegada.
2. **Formato Imutável:** Diferente do _Forza Motorsport_, o pacote de telemetria do _Forza Horizon 6_ possui formato **fixo**, não permitindo alternar entre layouts de dados (como o modo "Dash").
3. **Novos Campos (FH6 vs FM):** Desenvolvedores de aplicativos antigos devem se atentar à inclusão de três novos campos específicos do Horizon: `CarGroup`, `SmashableVelDiff` e `SmashableMass`. Eles estão localizados exatamente após o campo `NumCylinders` e antes de `PositionX`.
4. **Campos Removidos:** Os campos `TireWear` (desgaste de pneus) e `TrackOrdinal` (ID da pista), que estão presentes no formato "Dash" do _Forza Motorsport_, **não constam** no pacote do _Forza Horizon 6_.
